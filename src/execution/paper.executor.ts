import { v4 as uuid } from "uuid";
import { PAPER_CONFIG } from "../config/paper.js";
import { PaperOrder, PaperOrderState, PaperOrderType } from "./paper/types.js";
import { PositionStore } from "../state/position.store.js";
import { PnlTracker } from "../state/pnl.tracker.js";

type OrderUpdateHandler = (orderId: string, status: string) => void;
export type PaperStateChangeHandler = () => void | Promise<void>;

type PaperOrderFilters = {
  productIds?: number[];
  productSymbols?: string[];
  states?: PaperOrderState[];
};

type PaperPlaceOrderRequest = {
  product_id?: number | undefined;
  product_symbol?: string | undefined;
  limit_price?: number | undefined;
  size: number;
  side: "buy" | "sell";
  order_type: PaperOrderType;
  stop_price?: number | undefined;
  client_order_id?: string | undefined;
  reduce_only?: boolean | undefined;
};

type PaperEditOrderRequest = {
  id?: string | undefined;
  client_order_id?: string | undefined;
  product_id?: number | undefined;
  product_symbol?: string | undefined;
  limit_price?: number | undefined;
  size?: number | undefined;
  stop_price?: number | undefined;
};

type PaperBatchOrderRequest = {
  product_id?: number | undefined;
  product_symbol?: string | undefined;
  orders: PaperPlaceOrderRequest[];
};

type PaperBatchEditRequest = {
  product_id?: number | undefined;
  product_symbol?: string | undefined;
  orders: PaperEditOrderRequest[];
};

type PaperBatchCancelRequest = {
  product_id?: number | undefined;
  product_symbol?: string | undefined;
  orders: { id?: string | undefined; client_order_id?: string | undefined }[];
};

type PaperBracketRequest = {
  product_id?: number;
  product_symbol?: string;
  stop_loss_order?: { stop_price?: number; limit_price?: number };
  take_profit_order?: { stop_price?: number; limit_price?: number };
};

export class PaperExecutor {
  private orders = new Map<string, PaperOrder>();
  private onOrderUpdate?: OrderUpdateHandler;
  private lastPrices = new Map<string, number>();
  private leverages = new Map<string, number>();
  private contractValues = new Map<string, number>();
  private onStateChange?: PaperStateChangeHandler;

  constructor(
    private positions: PositionStore,
    private pnl: PnlTracker,
    onOrderUpdate?: OrderUpdateHandler,
    onStateChange?: PaperStateChangeHandler,
    private rng: () => number = Math.random
  ) {
    if (onOrderUpdate) this.onOrderUpdate = onOrderUpdate;
    if (onStateChange) this.onStateChange = onStateChange;
  }

  setOnOrderUpdate(handler?: OrderUpdateHandler) {
    if (handler) {
      this.onOrderUpdate = handler;
    } else {
      delete this.onOrderUpdate;
    }
  }

  setOnStateChange(handler?: PaperStateChangeHandler) {
    if (handler) {
      this.onStateChange = handler;
    } else {
      delete this.onStateChange;
    }
  }

  placeLimit(
    side: "buy" | "sell",
    price: number,
    qty: number,
    meta?: {
      productId?: number;
      productSymbol?: string;
      clientOrderId?: string;
      role?: PaperOrder["role"];
    }
  ): PaperOrder {
    return this.placeOrderInternal({
      ...(meta?.productId !== undefined ? { productId: meta.productId } : {}),
      ...(meta?.productSymbol !== undefined ? { productSymbol: meta.productSymbol } : {}),
      ...(meta?.clientOrderId !== undefined ? { clientOrderId: meta.clientOrderId } : {}),
      role: meta?.role,
      type: "limit",
      side,
      price,
      qty,
      stopPrice: undefined,
    });
  }

  placeStopMarket(
    side: "buy" | "sell",
    stopPrice: number,
    qty: number,
    meta?: {
      productId?: number;
      productSymbol?: string;
      clientOrderId?: string;
      role?: PaperOrder["role"];
    }
  ): PaperOrder {
    return this.placeOrderInternal({
      ...(meta?.productId !== undefined ? { productId: meta.productId } : {}),
      ...(meta?.productSymbol !== undefined ? { productSymbol: meta.productSymbol } : {}),
      ...(meta?.clientOrderId !== undefined ? { clientOrderId: meta.clientOrderId } : {}),
      role: meta?.role,
      type: "stop_market",
      side,
      price: undefined,
      qty,
      stopPrice,
    });
  }

  placeOrder(req: PaperPlaceOrderRequest): PaperOrder {
    return this.placeOrderInternal({
      ...(req.product_id !== undefined ? { productId: req.product_id } : {}),
      ...(req.product_symbol !== undefined ? { productSymbol: req.product_symbol } : {}),
      ...(req.client_order_id !== undefined ? { clientOrderId: req.client_order_id } : {}),
      type: req.order_type,
      side: req.side,
      price: req.limit_price,
      qty: req.size,
      stopPrice: req.stop_price,
    });
  }

  editOrder(req: PaperEditOrderRequest): PaperOrder | undefined {
    const order =
      (req.id ? this.orders.get(req.id) : undefined) ??
      (req.client_order_id
        ? this.findByClientOrderId(req.client_order_id)
        : undefined);
    if (!order || order.status !== "open") return undefined;
    if (req.product_id != null) order.productId = req.product_id;
    if (req.product_symbol) order.productSymbol = req.product_symbol;
    if (req.limit_price != null) order.price = req.limit_price;
    if (req.stop_price != null) order.stopPrice = req.stop_price;
    if (req.size != null) order.qty = req.size;
    return order;
  }

  cancelOrder(req: { id?: string | undefined; client_order_id?: string | undefined }): PaperOrder | undefined {
    const order =
      (req.id ? this.orders.get(req.id) : undefined) ??
      (req.client_order_id
        ? this.findByClientOrderId(req.client_order_id)
        : undefined);
    if (!order || order.status !== "open") return order;
    order.status = "cancelled";
    this.orders.delete(order.id);
    return order;
  }

  getOpenOrders(filters?: PaperOrderFilters): PaperOrder[] {
    const states = filters?.states ?? ["open", "pending"];
    const productIds = filters?.productIds;
    const productSymbols = filters?.productSymbols?.map((s) => s.toUpperCase());
    return Array.from(this.orders.values()).filter((order) => {
      if (!states.includes(order.status)) return false;
      if (productIds && order.productId != null && !productIds.includes(order.productId)) {
        return false;
      }
      if (
        productSymbols &&
        order.productSymbol &&
        !productSymbols.includes(order.productSymbol.toUpperCase())
      ) {
        return false;
      }
      return true;
    });
  }

  getOrderById(orderId: string): PaperOrder | undefined {
    return this.orders.get(orderId);
  }

  getOrderByClientId(clientOrderId: string): PaperOrder | undefined {
    return this.findByClientOrderId(clientOrderId);
  }

  placeBatchOrders(req: PaperBatchOrderRequest): PaperOrder[] {
    return req.orders.map((order) =>
      this.placeOrder({
        ...order,
        product_id: req.product_id ?? order.product_id,
        product_symbol: req.product_symbol ?? order.product_symbol,
      })
    );
  }

  editBatchOrders(req: PaperBatchEditRequest): PaperOrder[] {
    return req.orders
      .map((order) =>
        this.editOrder({
          ...order,
          product_id: req.product_id ?? order.product_id,
          product_symbol: req.product_symbol ?? order.product_symbol,
        })
      )
      .filter((order): order is PaperOrder => Boolean(order));
  }

  cancelBatchOrders(req: PaperBatchCancelRequest): PaperOrder[] {
    return req.orders
      .map((order) => this.cancelOrder(order))
      .filter((order): order is PaperOrder => Boolean(order));
  }

  placeBracketOrder(req: PaperBracketRequest): { stop?: PaperOrder; takeProfit?: PaperOrder } {
    const pos = this.positions.getByProduct(req.product_id, req.product_symbol);
    if (!pos) return {};
    const side = pos.side === "LONG" ? "sell" : "buy";
    const stopPrice = req.stop_loss_order?.stop_price;
    const tpPrice =
      req.take_profit_order?.limit_price ?? req.take_profit_order?.stop_price;
    const stop = stopPrice
      ? this.placeStopMarket(side, stopPrice, pos.qty, {
          ...(pos.productId !== undefined ? { productId: pos.productId } : {}),
          ...(pos.productSymbol !== undefined ? { productSymbol: pos.productSymbol } : {}),
          role: "stop",
        })
      : undefined;
    const takeProfit = tpPrice
      ? this.placeLimit(side, tpPrice, pos.qty, {
          ...(pos.productId !== undefined ? { productId: pos.productId } : {}),
          ...(pos.productSymbol !== undefined ? { productSymbol: pos.productSymbol } : {}),
          role: "take_profit",
        })
      : undefined;
    if (stopPrice || tpPrice) {
      this.setPositionBrackets(req.product_id, req.product_symbol, stopPrice, tpPrice);
    }
    return {
      ...(stop !== undefined ? { stop } : {}),
      ...(takeProfit !== undefined ? { takeProfit } : {}),
    };
  }

  editBracketOrder(req: PaperBracketRequest): { stop?: PaperOrder; takeProfit?: PaperOrder } {
    return this.placeBracketOrder(req);
  }

  setPositionBrackets(
    productId: number | undefined,
    productSymbol: string | undefined,
    stopPrice?: number,
    targetPrice?: number
  ) {
    this.positions.updateBrackets(productId, productSymbol, stopPrice, targetPrice);
  }

  setOrderLeverage(productId: number | undefined, productSymbol: string | undefined, leverage: number) {
    const key = this.leverageKey(productId, productSymbol);
    this.leverages.set(key, leverage);
    return { leverage, productId, productSymbol };
  }

  getOrderLeverage(productId: number | undefined, productSymbol: string | undefined) {
    const key = this.leverageKey(productId, productSymbol);
    return {
      leverage: this.leverages.get(key) ?? 1,
      productId,
      productSymbol,
    };
  }

  setContractValue(
    productId: number | undefined,
    productSymbol: string | undefined,
    contractValue: number
  ) {
    const key = this.leverageKey(productId, productSymbol);
    if (Number.isFinite(contractValue) && contractValue > 0) {
      this.contractValues.set(key, contractValue);
    }
    return { contractValue, productId, productSymbol };
  }

  getOpenPositions(filters?: { productIds?: number[]; productSymbols?: string[] }) {
    const productIds = filters?.productIds;
    const productSymbols = filters?.productSymbols?.map((s) => s.toUpperCase());
    return this.positions
      .all()
      .filter((pos) => {
        if (productIds && pos.productId != null && !productIds.includes(pos.productId)) {
          return false;
        }
        if (
          productSymbols &&
          pos.productSymbol &&
          !productSymbols.includes(pos.productSymbol.toUpperCase())
        ) {
          return false;
        }
        return true;
      });
  }

  getPosition(productId?: number, productSymbol?: string) {
    return this.positions.getByProduct(productId, productSymbol);
  }

  closePosition(productId?: number, productSymbol?: string, price?: number) {
    const pos = this.positions.getByProduct(productId, productSymbol);
    if (!pos) return;
    const fillPrice =
      price ?? this.lastPriceFor(productId, productSymbol) ?? pos.entryPrice;
    const contractValue = this.resolveContractValue(productId, productSymbol);
    const baseFee = fillPrice * pos.qty * contractValue * PAPER_CONFIG.takerFeePct;
    const fee = baseFee * (1 + PAPER_CONFIG.GST_RATE);
    const side = pos.side === "LONG" ? "sell" : "buy";
    this.applyFill(
      {
        side,
        price: fillPrice,
        qty: pos.qty,
        ...(productId !== undefined ? { productId } : {}),
        ...(productSymbol !== undefined ? { productSymbol } : {}),
      },
      fee
    );
    this.cancelBracketOrders(productId, productSymbol);
  }

  closeAllPositions(price?: number) {
    for (const pos of this.positions.all()) {
      this.closePosition(pos.productId, pos.productSymbol, price);
    }
  }

  cancel(orderId: string) {
    const order = this.orders.get(orderId);
    if (!order) return;
    order.status = "cancelled";
    this.orders.delete(orderId);
  }

  onTick(price: number, productId?: number, productSymbol?: string) {
    const key = this.leverageKey(productId, productSymbol);
    this.lastPrices.set(key, price);
    for (const order of this.orders.values()) {
      if (order.status !== "open") continue;
      if (!this.matchesOrder(order, productId, productSymbol)) continue;

      if (order.role === "stop" || order.role === "take_profit") {
        continue;
      }

      if (order.type === "market") {
        this.fillOrder(order, price, false);
      }

      if (order.type === "limit") {
        const canFill =
          (order.side === "buy" && price <= order.price!) ||
          (order.side === "sell" && price >= order.price!);

        if (canFill) {
          this.fillOrder(order, price, true);
        }
      }

      if (order.type === "stop_market") {
        const triggered =
          (order.side === "buy" && price >= order.stopPrice!) ||
          (order.side === "sell" && price <= order.stopPrice!);

        if (triggered) {
          this.fillOrder(order, price, false);
        }
      }
    }

    this.checkPositionBrackets(price, productId, productSymbol);
  }

  private fillOrder(order: PaperOrder, marketPrice: number, isMaker: boolean) {
    const slippage =
      marketPrice *
      PAPER_CONFIG.slippagePct *
      (order.side === "buy" ? 1 : -1);

    const fillPrice = marketPrice + slippage;

    const fillQty =
      this.rng() < PAPER_CONFIG.partialFillChance
        ? order.qty * 0.5
        : order.qty;

    order.filledQty += fillQty;
    order.status = order.filledQty >= order.qty ? "closed" : "open";

    const feePct = isMaker
      ? PAPER_CONFIG.makerFeePct
      : PAPER_CONFIG.takerFeePct;

    const contractValue = this.resolveContractValue(order.productId, order.productSymbol);
    const baseFee = fillPrice * fillQty * contractValue * feePct;
    const fee = baseFee * (1 + PAPER_CONFIG.GST_RATE);

    this.applyFill(
      {
        side: order.side,
        price: fillPrice,
        qty: fillQty,
        ...(order.productId !== undefined ? { productId: order.productId } : {}),
        ...(order.productSymbol !== undefined ? { productSymbol: order.productSymbol } : {}),
      },
      fee
    );

    if (order.status === "closed") {
      this.onOrderUpdate?.(order.id, "closed");
      this.orders.delete(order.id);
    }
  }

  private applyFill(
    fill: {
      side: "buy" | "sell";
      price: number;
      qty: number;
      productId?: number;
      productSymbol?: string;
    },
    feeUSD: number
  ) {
    try {
      const feeINR = feeUSD * PAPER_CONFIG.USDINR;
      this.pnl.record(-feeINR); // Always deduct fee for every fill (Opening/Closing/Adding)

      const existing = this.positions.getByProduct(fill.productId, fill.productSymbol);
      if (!existing) {
        this.positions.open({
          side: fill.side === "buy" ? "LONG" : "SHORT",
          qty: fill.qty,
          entryPrice: fill.price,
          ...(fill.productId !== undefined ? { productId: fill.productId } : {}),
          ...(fill.productSymbol !== undefined ? { productSymbol: fill.productSymbol } : {}),
          stopPrice: undefined,
          targetPrice: undefined,
          cachedProduct: this.resolveCachedProduct(fill.productId, fill.productSymbol),
        });
        return;
      }

      const pos = existing;
      const contractValue = this.resolveContractValue(fill.productId, fill.productSymbol);
      const fillSide = fill.side === "buy" ? "LONG" : "SHORT";

      if (fillSide === pos.side) {
        const totalQty = pos.qty + fill.qty;
        const weightedEntry = (pos.entryPrice * pos.qty + fill.price * fill.qty) / totalQty;
        pos.entryPrice = weightedEntry;
        pos.qty = totalQty;
        return;
      }

      const closingQty = Math.min(pos.qty, fill.qty);
      const pnlUSD =
        pos.side === "LONG"
          ? (fill.price - pos.entryPrice) * closingQty * contractValue
          : (pos.entryPrice - fill.price) * closingQty * contractValue;

      const pnlINR = pnlUSD * PAPER_CONFIG.USDINR;
      this.pnl.record(pnlINR); // Record closing PnL separately

      if (fill.qty < pos.qty) {
        pos.qty -= fill.qty;
        return;
      }

      if (fill.qty === pos.qty) {
        this.positions.close(fill.productId, fill.productSymbol);
        return;
      }

      const remainingQty = fill.qty - pos.qty;
      this.positions.open({
        side: fillSide,
        qty: remainingQty,
        entryPrice: fill.price,
        ...(fill.productId !== undefined ? { productId: fill.productId } : {}),
        ...(fill.productSymbol !== undefined ? { productSymbol: fill.productSymbol } : {}),
        stopPrice: undefined,
        targetPrice: undefined,
      });
    } finally {
      this.onStateChange?.();
    }
  }

  private findByClientOrderId(clientOrderId: string): PaperOrder | undefined {
    for (const order of this.orders.values()) {
      if (order.clientOrderId === clientOrderId) return order;
    }
    return undefined;
  }

  private placeOrderInternal(input: {
    productId?: number | undefined;
    productSymbol?: string | undefined;
    clientOrderId?: string | undefined;
    role?: PaperOrder["role"] | undefined;
    type: PaperOrderType;
    side: "buy" | "sell";
    price?: number | undefined;
    qty: number;
    stopPrice?: number | undefined;
  }): PaperOrder {
    const order: PaperOrder = {
      id: uuid(),
      clientOrderId: input.clientOrderId,
      productId: input.productId,
      productSymbol: input.productSymbol,
      role: input.role,
      type: input.type,
      side: input.side,
      price: input.price,
      stopPrice: input.stopPrice,
      qty: input.qty,
      filledQty: 0,
      status: "open",
      createdAt: Date.now(),
    };

    this.orders.set(order.id, order);

    if (order.type === "market") {
      const lastPrice = this.lastPriceFor(order.productId, order.productSymbol);
      if (lastPrice != null) {
        this.fillOrder(order, lastPrice, false);
      }
    }

    return order;
  }

  private checkPositionBrackets(
    price: number,
    productId?: number,
    productSymbol?: string
  ) {
    for (const pos of this.positions.all()) {
      if (!this.matchesPosition(pos, productId, productSymbol)) continue;
      if (pos.stopPrice == null && pos.targetPrice == null) continue;
      const isLong = pos.side === "LONG";
      const hitStop = pos.stopPrice != null && (isLong ? price <= pos.stopPrice : price >= pos.stopPrice);
      const hitTarget =
        pos.targetPrice != null && (isLong ? price >= pos.targetPrice : price <= pos.targetPrice);
      if (!hitStop && !hitTarget) continue;
      this.closePosition(pos.productId, pos.productSymbol, price);
      break;
    }
  }

  private cancelBracketOrders(productId?: number, productSymbol?: string) {
    const symbol = productSymbol?.toUpperCase();
    for (const order of this.orders.values()) {
      if (order.role !== "stop" && order.role !== "take_profit") continue;
      if (productId != null && order.productId != null && order.productId !== productId) {
        continue;
      }
      if (symbol && order.productSymbol && order.productSymbol.toUpperCase() !== symbol) {
        continue;
      }
      order.status = "cancelled";
      this.orders.delete(order.id);
    }
  }

  private leverageKey(productId?: number, productSymbol?: string) {
    if (productId != null) return `id:${productId}`;
    if (productSymbol) return `sym:${productSymbol.toUpperCase()}`;
    return "default";
  }

  private lastPriceFor(productId?: number, productSymbol?: string) {
    const key = this.leverageKey(productId, productSymbol);
    return this.lastPrices.get(key);
  }

  private matchesOrder(
    order: PaperOrder,
    productId?: number,
    productSymbol?: string
  ) {
    if (productId != null && order.productId != null) {
      return order.productId === productId;
    }
    if (productSymbol && order.productSymbol) {
      return order.productSymbol.toUpperCase() === productSymbol.toUpperCase();
    }
    if (productId == null && productSymbol == null) {
      return order.productId == null && order.productSymbol == null;
    }
    return false;
  }

  private matchesPosition(
    pos: { productId?: number | undefined; productSymbol?: string | undefined },
    productId?: number | undefined,
    productSymbol?: string | undefined
  ) {
    if (productId != null && pos.productId != null) {
      return pos.productId === productId;
    }
    if (productSymbol && pos.productSymbol) {
      return pos.productSymbol.toUpperCase() === productSymbol.toUpperCase();
    }
    if (productId == null && productSymbol == null) {
      return pos.productId == null && pos.productSymbol == null;
    }
    return false;
  }

  private resolveContractValue(productId?: number, productSymbol?: string) {
    const key = this.leverageKey(productId, productSymbol);
    return this.contractValues.get(key) ?? 1;
  }

  private resolveCachedProduct(productId?: number, productSymbol?: string): any {
    // In current main.ts, we don't strictly have a global product cache access for the executor,
    // but the executor's state could be extended if we needed full metadata.
    // For now, we return undefined and let main.ts fallback to contractValue=1 if missing.
    return undefined;
  }
}
