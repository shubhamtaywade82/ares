import { DeltaRestClient } from "../delta/rest.client.js";
import { DeltaWsClient } from "../delta/ws.client.js";
import { PaperExecutor } from "../execution/paper.executor.js";
import { PaperOrder } from "../execution/paper/types.js";
import { PositionStore } from "../state/position.store.js";
import { PnlTracker } from "../state/pnl.tracker.js";

export type PaperTradeConfig = {
  productSymbol: string;
  productId?: number;
  leverage: number;
  profitTargetPercent: number;
  stopLossPercent: number;
  riskPerTrade: number;
  side: "buy" | "sell";
  useMarketOrder: boolean;
  logEveryMs: number;
};

type DeltaProduct = {
  id: number;
  symbol: string;
  contract_value?: string;
  tick_size?: string;
  default_leverage?: string;
  settling_asset?: { symbol?: string };
};

type DeltaTicker = {
  symbol?: string;
  mark_price?: number | string;
  close?: number | string;
  spot_price?: number | string;
  price?: number | string;
};

type LocalPosition = {
  productId: number;
  symbol: string;
  side: "buy" | "sell";
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  pnlPercent: number;
  stopLoss: number;
  takeProfit: number;
  timestamp: number;
};

export class PaperTrader {
  private rest: DeltaRestClient;
  private ws?: DeltaWsClient;
  private paper: PaperExecutor;
  private positions: PositionStore;
  private pnl: PnlTracker;
  private lastLogAt = 0;
  private entryOrder?: PaperOrder;
  private done = false;

  constructor(private config: PaperTradeConfig) {
    this.rest = new DeltaRestClient();
    this.positions = new PositionStore();
    this.pnl = new PnlTracker();
    this.paper = new PaperExecutor(this.positions, this.pnl);
  }

  async run(): Promise<void> {
    console.log("=".repeat(60));
    console.log("[ARES.PAPER] DELTA EXCHANGE PAPER FLOW");
    console.log("=".repeat(60));

    const product = await this.selectProduct(this.config.productSymbol);
    const currentPrice = await this.getCurrentPrice(this.config.productSymbol);

    console.log(`\n[ARES.PAPER] Current Price: ₹${currentPrice.toFixed(2)}`);

    const side = this.config.side;
    const entryPrice = currentPrice;

    const stopLoss = this.calculateStopLoss(
      entryPrice,
      side,
      this.config.stopLossPercent
    );

    const takeProfit = this.calculateTakeProfit(
      entryPrice,
      side,
      this.config.profitTargetPercent
    );

    const contractValue = Number(product.contract_value ?? 1);
    const lotSize = this.calculateLotSize(
      entryPrice,
      stopLoss,
      this.config.riskPerTrade,
      Number.isFinite(contractValue) && contractValue > 0 ? contractValue : 1
    );

    console.log("\n[ARES.PAPER] Trade Plan:");
    console.log(`  Side: ${side.toUpperCase()}`);
    console.log(`  Entry: ₹${entryPrice.toFixed(2)}`);
    console.log(
      `  Stop Loss: ₹${stopLoss.toFixed(2)} (-${this.config.stopLossPercent}%)`
    );
    console.log(
      `  Take Profit: ₹${takeProfit.toFixed(2)} (+${this.config.profitTargetPercent}%)`
    );
    console.log(`  Risk: ₹${this.config.riskPerTrade}`);
    console.log(`  Lot Size: ${lotSize} contracts`);

    this.setLeverage(product.id, product.symbol, this.config.leverage);

    console.log("\n[ARES.PAPER] Waiting 3 seconds before placing order...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    this.entryOrder = this.placeOrder(
      product.id,
      product.symbol,
      side,
      lotSize,
      entryPrice,
      this.config.useMarketOrder,
      product.tick_size
    );

    this.paper.setOnOrderUpdate((orderId, status) => {
      if (!this.entryOrder || orderId !== this.entryOrder.id || status !== "closed") {
        return;
      }
      const pos = this.positions.getByProduct(product.id, product.symbol);
      if (pos) {
        console.log("\n[ARES.PAPER] Entry filled");
        console.log(`  Filled Price: ₹${pos.entryPrice.toFixed(2)}`);
        console.log(`  Size: ${pos.qty} contracts`);
      }
    });

    console.log("\n[ARES.PAPER] Starting position monitoring...");
    console.log("[ARES.PAPER] Press Ctrl+C to stop\n");

    this.startWs(product.symbol, product.id, stopLoss, takeProfit);

    process.on("SIGINT", () => {
      if (this.done) return;
      console.log("\n[ARES.PAPER] Stopping monitoring...");
      this.done = true;
      process.exit(0);
    });
  }

  private async selectProduct(symbol: string): Promise<DeltaProduct> {
    console.log(`\n[ARES.PAPER] STEP 1: Selecting product ${symbol}...`);

    const response = await this.rest.getProductBySymbol(symbol);
    const product = response.result as DeltaProduct;

    console.log(`✓ Product: ${product.symbol}`);
    console.log(`  - Product ID: ${product.id}`);
    console.log(`  - Contract Size: ${product.contract_value ?? "unknown"}`);
    console.log(`  - Tick Size: ${product.tick_size ?? "unknown"}`);
    console.log(`  - Max Leverage: ${product.default_leverage ?? "unknown"}x`);
    console.log(`  - Settling Asset: ${product.settling_asset?.symbol ?? "unknown"}`);

    return product;
  }

  private async getCurrentPrice(symbol: string): Promise<number> {
    const response = await this.rest.getTickers();
    const tickers = response.result as DeltaTicker[];
    const match = tickers.find(
      (ticker) => ticker.symbol?.toUpperCase() === symbol.toUpperCase()
    );
    const rawPrice =
      match?.mark_price ?? match?.close ?? match?.spot_price ?? match?.price;
    const parsed = typeof rawPrice === "string" ? Number(rawPrice) : rawPrice;
    if (!Number.isFinite(parsed)) {
      throw new Error(`[ARES.PAPER] Failed to resolve current price for ${symbol}`);
    }
    return Number(parsed);
  }

  private calculateLotSize(
    entryPrice: number,
    stopLossPrice: number,
    riskAmount: number,
    contractValue: number
  ): number {
    console.log("\n[ARES.PAPER] STEP 2: Calculating lot size...");

    const riskPerContract = Math.abs(entryPrice - stopLossPrice) * contractValue;
    const calculatedSize = Math.floor(riskAmount / riskPerContract);
    const lotSize = Math.max(1, calculatedSize);

    console.log(`  Entry Price: ₹${entryPrice}`);
    console.log(`  Stop Loss: ₹${stopLossPrice}`);
    console.log(`  Risk Amount: ₹${riskAmount}`);
    console.log(`  Risk per Contract: ₹${riskPerContract.toFixed(2)}`);
    console.log(`✓ Lot Size: ${lotSize} contracts`);

    return lotSize;
  }

  private calculateStopLoss(entryPrice: number, side: "buy" | "sell", percent: number): number {
    if (side === "buy") {
      return entryPrice * (1 - percent / 100);
    }
    return entryPrice * (1 + percent / 100);
  }

  private calculateTakeProfit(entryPrice: number, side: "buy" | "sell", percent: number): number {
    if (side === "buy") {
      return entryPrice * (1 + percent / 100);
    }
    return entryPrice * (1 - percent / 100);
  }

  private setLeverage(productId: number, productSymbol: string, leverage: number): void {
    console.log(`\n[ARES.PAPER] STEP 3: Setting leverage to ${leverage}x...`);
    this.paper.setOrderLeverage(productId, productSymbol, leverage);
    console.log(`✓ Leverage set to ${leverage}x`);
  }

  private placeOrder(
    productId: number,
    productSymbol: string,
    side: "buy" | "sell",
    size: number,
    price: number,
    useMarketOrder: boolean,
    tickSize?: string
  ): PaperOrder {
    console.log(`\n[ARES.PAPER] STEP 4: Placing ${side.toUpperCase()} order...`);

    const roundedPrice = this.roundToTick(price, tickSize);

    const order = this.paper.placeOrder({
      product_id: productId,
      product_symbol: productSymbol,
      size,
      side,
      order_type: useMarketOrder ? "market" : "limit",
      limit_price: useMarketOrder ? undefined : roundedPrice,
    });

    console.log("✓ Order placed successfully");
    console.log(`  - Order ID: ${order.id}`);
    console.log(`  - Side: ${order.side}`);
    console.log(`  - Size: ${order.qty}`);
    console.log(`  - Price: ${order.price ?? "Market"}`);
    console.log(`  - State: ${order.status}`);

    return order;
  }

  private startWs(
    symbol: string,
    productId: number,
    stopLoss: number,
    takeProfit: number
  ) {
    this.ws = new DeltaWsClient(
      (msg: { type?: string; price?: number | string; timestamp?: number }) => {
        if (this.done) return;
        const msgType = msg.type;
        const isTicker = msgType === "ticker" || msgType === "v2/ticker";
        if (!isTicker) return;

        const rawPrice =
          (msg as any).mark_price ??
          (msg as any).close ??
          (msg as any).spot_price ??
          msg.price;
        const price = Number(rawPrice);
        if (!Number.isFinite(price)) return;

        this.paper.onTick(price);
        this.handleTick(productId, symbol, price, stopLoss, takeProfit);
      },
      () => {
        console.error("[ARES.PAPER] WS fatal; exiting");
        process.exit(1);
      },
      () => {
        console.info("[ARES.PAPER] WS connected; subscribing to ticker");
        this.ws?.subscribe("v2/ticker", [symbol]);
      }
    );

    this.ws.connect();
  }

  private handleTick(
    productId: number,
    symbol: string,
    price: number,
    stopLoss: number,
    takeProfit: number
  ) {
    const now = Date.now();
    if (now - this.lastLogAt < this.config.logEveryMs) {
      return;
    }
    this.lastLogAt = now;

    const position = this.positions.getByProduct(productId, symbol);

    if (!position) {
      if (this.entryOrder && !this.done) {
        console.log("[ARES.PAPER] Waiting for entry fill...");
      }
      return;
    }

    const side: "buy" | "sell" = position.side === "LONG" ? "buy" : "sell";
    const size = position.qty;
    const entryPrice = position.entryPrice;

    const unrealizedPnl =
      side === "buy"
        ? (price - entryPrice) * size
        : (entryPrice - price) * size;

    const pnlPercent = (unrealizedPnl / (entryPrice * size)) * 100;

    const localPosition: LocalPosition = {
      productId,
      symbol,
      side,
      size,
      entryPrice,
      currentPrice: price,
      unrealizedPnl,
      pnlPercent,
      stopLoss,
      takeProfit,
      timestamp: now,
    };

    this.displayPosition(localPosition);

    const exitCheck = this.shouldExit(localPosition);
    if (!exitCheck.exit) return;

    console.log(`\n[ARES.PAPER] Exit condition met: ${exitCheck.reason}`);
    this.paper.closePosition(productId, symbol, price);

    console.log("\n[ARES.PAPER] Trade completed!");
    console.log(
      `Final PnL: ₹${this.pnl.value.toFixed(2)} (${localPosition.pnlPercent.toFixed(2)}%)`
    );

    this.done = true;
    process.exit(0);
  }

  private displayPosition(position: LocalPosition): void {
    console.log("\n[ARES.PAPER] Position Status:");
    console.log(`  Symbol: ${position.symbol}`);
    console.log(`  Side: ${position.side.toUpperCase()}`);
    console.log(`  Size: ${position.size} contracts`);
    console.log(`  Entry: ₹${position.entryPrice.toFixed(2)}`);
    console.log(`  Current: ₹${position.currentPrice.toFixed(2)}`);
    console.log(
      `  PnL: ₹${position.unrealizedPnl.toFixed(2)} (${position.pnlPercent.toFixed(2)}%)`
    );
    console.log(`  Stop Loss: ₹${position.stopLoss.toFixed(2)}`);
    console.log(`  Take Profit: ₹${position.takeProfit.toFixed(2)}`);
  }

  private shouldExit(position: LocalPosition): { exit: boolean; reason: string } {
    if (position.side === "buy") {
      if (position.currentPrice <= position.stopLoss) {
        return { exit: true, reason: "Stop Loss Hit" };
      }
      if (position.currentPrice >= position.takeProfit) {
        return { exit: true, reason: "Take Profit Hit" };
      }
    } else {
      if (position.currentPrice >= position.stopLoss) {
        return { exit: true, reason: "Stop Loss Hit" };
      }
      if (position.currentPrice <= position.takeProfit) {
        return { exit: true, reason: "Take Profit Hit" };
      }
    }

    return { exit: false, reason: "" };
  }

  private roundToTick(price: number, tickSize?: string) {
    const tick = tickSize ? Number(tickSize) : undefined;
    if (!tick || !Number.isFinite(tick) || tick <= 0) {
      return Number(price.toFixed(1));
    }
    return Math.round(price / tick) * tick;
  }
}
