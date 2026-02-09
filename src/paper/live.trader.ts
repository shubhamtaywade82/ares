import { DeltaRestClient } from "../delta/rest.client.js";
import { DeltaWsClient } from "../delta/ws.client.js";
import { OrderManager } from "../execution/order.manager.js";
import { ExecutionRequest } from "../execution/types.js";
import { OrderStore } from "../state/order.store.js";
import { PositionStore } from "../state/position.store.js";
import { PnlTracker } from "../state/pnl.tracker.js";

export type LiveTradeConfig = {
  productSymbol: string;
  productId?: number;
  capital: number;
  leverage: number;
  profitTargetPercent: number;
  stopLossPercent: number;
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

type LivePosition = {
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

export class LiveTrader {
  private rest: DeltaRestClient;
  private ws?: DeltaWsClient;
  private orderManager: OrderManager;
  private orderStore: OrderStore;
  private positions: PositionStore;
  private pnl: PnlTracker;
  private lastLogAt = 0;
  private resolveRun?: () => void;
  private rejectRun?: (error?: Error) => void;
  private finished = false;
  private contractValue = 1;
  private activeOrderSet?: { entryOrderId?: string; stopOrderId?: string; targetOrderId?: string };

  constructor(private config: LiveTradeConfig) {
    this.rest = new DeltaRestClient();
    this.orderStore = new OrderStore();
    this.positions = new PositionStore();
    this.pnl = new PnlTracker();
    this.orderManager = new OrderManager(this.rest, this.orderStore, "live");
  }

  async run(): Promise<void> {
    console.log("=".repeat(60));
    console.log("[ARES.LIVE] DELTA EXCHANGE LIVE TRADING FLOW");
    console.log("=".repeat(60));

    const product = await this.selectProduct(this.config.productSymbol);
    const currentPrice = await this.getCurrentPrice(this.config.productSymbol);

    console.log(`\n[ARES.LIVE] Current Price: ₹${currentPrice.toFixed(2)}`);

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
    this.contractValue =
      Number.isFinite(contractValue) && contractValue > 0 ? contractValue : 1;

    const lotSize = this.calculateMaxContracts(
      this.config.capital,
      this.config.leverage,
      entryPrice,
      this.contractValue
    );

    console.log("\n[ARES.LIVE] Trade Plan:");
    console.log(`  Side: ${side.toUpperCase()}`);
    console.log(`  Entry: ₹${entryPrice.toFixed(2)}`);
    console.log(
      `  Stop Loss: ₹${stopLoss.toFixed(2)} (-${this.config.stopLossPercent}%)`
    );
    console.log(
      `  Take Profit: ₹${takeProfit.toFixed(2)} (+${this.config.profitTargetPercent}%)`
    );
    console.log(`  Capital: ₹${this.config.capital}`);
    console.log(`  Leverage: ${this.config.leverage}x`);
    console.log(`  Lot Size: ${lotSize} contracts`);

    console.log("\n[ARES.LIVE] Setting leverage...");
    try {
      await this.rest.placeOrder({
        product_symbol: product.symbol,
        side: side === "buy" ? "buy" : "sell",
        type: "limit",
        price: entryPrice,
        size: 0,
        leverage: this.config.leverage,
      });
    } catch (err) {
      console.warn(`[ARES.LIVE] Leverage set failed (may not be supported): ${err}`);
    }

    console.log("\n[ARES.LIVE] Waiting 3 seconds before placing order...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const orderSet = await this.placeOrder(
      product.id,
      product.symbol,
      side,
      lotSize,
      entryPrice,
      stopLoss,
      takeProfit,
      this.config.useMarketOrder
    );

    this.activeOrderSet = orderSet;

    console.log("\n[ARES.LIVE] Starting position monitoring...");
    console.log("[ARES.LIVE] Press Ctrl+C to stop\n");

    this.startWs(product.symbol, product.id, stopLoss, takeProfit);
    return new Promise<void>((resolve, reject) => {
      this.resolveRun = resolve;
      this.rejectRun = reject;
    });
  }

  private async selectProduct(symbol: string): Promise<DeltaProduct> {
    console.log(`\n[ARES.LIVE] STEP 1: Selecting product ${symbol}...`);

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
      throw new Error(`[ARES.LIVE] Failed to resolve current price for ${symbol}`);
    }
    return Number(parsed);
  }

  private calculateMaxContracts(
    capital: number,
    leverage: number,
    entryPrice: number,
    contractValue: number
  ): number {
    console.log("\n[ARES.LIVE] STEP 2: Calculating max contracts...");

    const buyingPower = capital * leverage;
    const valuePerContract = entryPrice * contractValue;
    const calculatedSize = Math.floor(buyingPower / valuePerContract);
    const lotSize = Math.max(1, calculatedSize);

    console.log(`  Capital: ₹${capital}`);
    console.log(`  Leverage: ${leverage}x`);
    console.log(`  Entry Price: ₹${entryPrice}`);
    console.log(`  Contract Size: ${contractValue}`);
    console.log(`  Value per Contract: ₹${valuePerContract.toFixed(2)}`);
    console.log(`  Buying Power: ₹${buyingPower.toFixed(2)}`);
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

  private async placeOrder(
    productId: number,
    productSymbol: string,
    side: "buy" | "sell",
    size: number,
    entryPrice: number,
    stopLoss: number,
    takeProfit: number,
    useMarketOrder: boolean
  ) {
    console.log(`\n[ARES.LIVE] STEP 3: Placing ${side.toUpperCase()} order...`);

    const req: ExecutionRequest = {
      symbol: productSymbol,
      side: side === "buy" ? "LONG" : "SHORT",
      entryPrice,
      stopPrice: stopLoss,
      targetPrice: takeProfit,
      qty: size,
      useMarketEntry: useMarketOrder,
    };

    const orderSet = await this.orderManager.execute(req);

    console.log("✓ Orders placed successfully");
    if (orderSet.entryOrderId) {
      console.log(`  - Entry Order ID: ${orderSet.entryOrderId}`);
    }
    if (orderSet.stopOrderId) {
      console.log(`  - Stop Loss Order ID: ${orderSet.stopOrderId}`);
    }
    if (orderSet.targetOrderId) {
      console.log(`  - Take Profit Order ID: ${orderSet.targetOrderId}`);
    }

    return orderSet;
  }

  private startWs(
    symbol: string,
    productId: number,
    stopLoss: number,
    takeProfit: number
  ) {
    this.ws = new DeltaWsClient(
      (msg: any) => {
        if (this.finished) return;

        const msgType = msg.type;

        if (msgType === "orders") {
          this.handleOrderUpdate(msg);
          return;
        }

        if (msgType === "positions") {
          this.handlePositionUpdate(msg, symbol, productId, stopLoss, takeProfit);
          return;
        }

        const isTicker = msgType === "ticker" || msgType === "v2/ticker";
        if (!isTicker) return;

        const msgSymbol = msg.symbol ?? msg.product_symbol;
        if (!msgSymbol || msgSymbol.toUpperCase() !== symbol.toUpperCase()) return;

        const rawPrice =
          msg.mark_price ?? msg.close ?? msg.spot_price ?? msg.price;
        const price = Number(rawPrice);
        if (!Number.isFinite(price)) return;

        this.handleTick(productId, symbol, price, stopLoss, takeProfit);
      },
      () => {
        console.error("[ARES.LIVE] WS fatal; exiting");
        this.finishRun("WS connection failed", new Error("WS failure"));
      },
      () => {
        console.info("[ARES.LIVE] WS connected; subscribing to channels");
        this.ws?.subscribe("v2/ticker", [symbol]);
        if (this.ws?.isAuthenticated()) {
          this.ws?.subscribe("orders", ["all"]);
          this.ws?.subscribe("positions", ["all"]);
        }
      },
      {
        auth: true,
        onAuth: (success) => {
          if (success) {
            console.info("[ARES.LIVE] WS authenticated; private channels enabled");
          } else {
            console.warn("[ARES.LIVE] WS auth failed; position monitoring limited");
          }
        },
      }
    );

    this.ws.connect();
  }

  private handleOrderUpdate(msg: any) {
    const orders = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
    for (const order of orders) {
      const orderId = String(order.id ?? order.order_id);
      const status = order.status ?? order.state;
      const symbol = order.product_symbol ?? order.symbol;

      if (!this.activeOrderSet) return;
      if (
        orderId !== this.activeOrderSet.entryOrderId &&
        orderId !== this.activeOrderSet.stopOrderId &&
        orderId !== this.activeOrderSet.targetOrderId
      ) {
        continue;
      }

      if (status === "closed" || status === "filled") {
        console.log(`[ARES.LIVE] Order ${orderId} filled: ${symbol}`);
        if (orderId === this.activeOrderSet.stopOrderId || orderId === this.activeOrderSet.targetOrderId) {
          console.log(`[ARES.LIVE] Position closed via ${orderId === this.activeOrderSet.stopOrderId ? "Stop Loss" : "Take Profit"}`);
          this.finishRun("Position closed");
        }
      }
    }
  }

  private handlePositionUpdate(
    msg: any,
    symbol: string,
    productId: number,
    stopLoss: number,
    takeProfit: number
  ) {
    const positions = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
    for (const pos of positions) {
      const posSymbol = pos.product_symbol ?? pos.symbol;
      if (!posSymbol || posSymbol.toUpperCase() !== symbol.toUpperCase()) continue;

      const size = Number(pos.size ?? 0);
      if (!Number.isFinite(size) || size === 0) {
        if (this.positions.getByProduct(productId, symbol)) {
          console.log(`[ARES.LIVE] Position closed: ${symbol}`);
          this.finishRun("Position closed");
        }
        return;
      }

      const entryPrice = Number(pos.entry_price ?? pos.avg_price ?? 0);
      const markPrice = Number(pos.mark_price ?? pos.market_price ?? 0);
      if (!Number.isFinite(entryPrice) || !Number.isFinite(markPrice)) return;

      this.positions.open({
        side: size > 0 ? "LONG" : "SHORT",
        qty: Math.abs(size),
        entryPrice,
        productId,
        productSymbol: symbol,
        stopPrice: stopLoss,
        targetPrice: takeProfit,
      });
    }
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
      return;
    }

    const side: "buy" | "sell" = position.side === "LONG" ? "buy" : "sell";
    const size = position.qty;
    const entryPrice = position.entryPrice;

    const unrealizedPnl =
      side === "buy"
        ? (price - entryPrice) * size * this.contractValue
        : (entryPrice - price) * size * this.contractValue;

    const positionValue = entryPrice * size * this.contractValue;
    const margin = positionValue / this.config.leverage;
    const pnlPercent = margin > 0 ? (unrealizedPnl / margin) * 100 : 0;

    const localPosition: LivePosition = {
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
  }

  private displayPosition(position: LivePosition): void {
    console.log("\n[ARES.LIVE] Position Status:");
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

  stop(reason?: string) {
    this.finishRun(reason ?? "Stopped");
  }

  private finishRun(reason?: string, error?: Error) {
    if (this.finished) return;
    this.finished = true;
    if (reason) {
      console.log(`[ARES.LIVE] Flow ended: ${reason}`);
    }
    this.ws?.disconnect();
    if (error) {
      this.rejectRun?.(error);
    } else {
      this.resolveRun?.();
    }
    this.resolveRun = undefined;
    this.rejectRun = undefined;
  }
}
