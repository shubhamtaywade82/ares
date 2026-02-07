import { v4 as uuid } from "uuid";
import { PAPER_CONFIG } from "../config/paper.js";
import { PaperOrder, PaperOrderState, PaperOrderType } from "./paper/types.js";
import { PositionStore } from "../state/position.store.js";
import { PnlTracker } from "../state/pnl.tracker.js";

type OrderUpdateHandler = (orderId: string, status: string) => void;

type PaperOrderFilters = {
  productIds?: number[];
  productSymbols?: string[];
  states?: PaperOrderState[];
};

type PaperPlaceOrderRequest = {
  product_id?: number;
  product_symbol?: string;
  limit_price?: number;
  size: number;
  side: "buy" | "sell";
  order_type: PaperOrderType;
  stop_price?: number;
  client_order_id?: string;
  reduce_only?: boolean;
};

type PaperEditOrderRequest = {
  id?: string;
  client_order_id?: string;
  product_id?: number;
  product_symbol?: string;
  limit_price?: number;
  size?: number;
  stop_price?: number;
};

type PaperBatchOrderRequest = {
  product_id?: number;
  product_symbol?: string;
  orders: PaperPlaceOrderRequest[];
};

type PaperBatchEditRequest = {
  product_id?: number;
  product_symbol?: string;
  orders: PaperEditOrderRequest[];
};

type PaperBatchCancelRequest = {
  product_id?: number;
  product_symbol?: string;
  orders: { id?: string; client_order_id?: string }[];
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
  private lastPrice: number | undefined;
  private leverages = new Map<string, number>();
  private contractValues = new Map<string, number>();

  constructor(
    private positions: PositionStore,
    private pnl: PnlTracker,
    onOrderUpdate?: OrderUpdateHandler,
    private rng: () => number = Math.random
  ) {
    this.onOrderUpdate = onOrderUpdate;
  }

  setOnOrderUpdate(handler?: OrderUpdateHandler) {
    this.onOrderUpdate = handler;
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
      productId: meta?.productId,
      productSymbol: meta?.productSymbol,
      clientOrderId: meta?.clientOrderId,
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
      productId: meta?.productId,
      productSymbol: meta?.productSymbol,
      clientOrderId: meta?.clientOrderId,
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
      productId: req.product_id,
      productSymbol: req.product_symbol,
      clientOrderId: req.client_order_id,
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

  cancelOrder(req: { id?: string; client_order_id?: string }): PaperOrder | undefined {
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
          productId: req.product_id,
          productSymbol: req.product_symbol,
          role: "stop",
        })
      : undefined;
    const takeProfit = tpPrice
      ? this.placeLimit(side, tpPrice, pos.qty, {
          productId: req.product_id,
          productSymbol: req.product_symbol,
          role: "take_profit",
        })
      : undefined;
    if (stopPrice || tpPrice) {
      this.setPositionBrackets(req.product_id, req.product_symbol, stopPrice, tpPrice);
    }
    return { stop, takeProfit };
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
    const fillPrice = price ?? this.lastPrice ?? pos.entryPrice;
    const contractValue = this.resolveContractValue(productId, productSymbol);
    const fee = fillPrice * pos.qty * contractValue * PAPER_CONFIG.takerFeePct;
    const side = pos.side === "LONG" ? "sell" : "buy";
    this.applyFill(
      {
        side,
        price: fillPrice,
        qty: pos.qty,
        productId,
        productSymbol,
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

  onTick(price: number) {
    this.lastPrice = price;
    for (const order of this.orders.values()) {
      if (order.status !== "open") continue;

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

    this.checkPositionBrackets(price);
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
    const fee = fillPrice * fillQty * contractValue * feePct;

    this.applyFill(
      {
        side: order.side,
        price: fillPrice,
        qty: fillQty,
        productId: order.productId,
        productSymbol: order.productSymbol,
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
    fee: number
  ) {
    const existing = this.positions.getByProduct(fill.productId, fill.productSymbol);
    if (!existing) {
      this.positions.open({
        side: fill.side === "buy" ? "LONG" : "SHORT",
        qty: fill.qty,
        entryPrice: fill.price,
        productId: fill.productId,
        productSymbol: fill.productSymbol,
        stopPrice: undefined,
        targetPrice: undefined,
      });
      return;
    }

    const pos = existing;
    const contractValue = this.resolveContractValue(fill.productId, fill.productSymbol);
    const pnl =
      pos.side === "LONG"
        ? (fill.price - pos.entryPrice) * fill.qty * contractValue
        : (pos.entryPrice - fill.price) * fill.qty * contractValue;

    this.pnl.record(pnl - fee);
    this.positions.close(fill.productId, fill.productSymbol);
  }

  private findByClientOrderId(clientOrderId: string): PaperOrder | undefined {
    for (const order of this.orders.values()) {
      if (order.clientOrderId === clientOrderId) return order;
    }
    return undefined;
  }

  private placeOrderInternal(input: {
    productId?: number;
    productSymbol?: string;
    clientOrderId?: string;
    role?: PaperOrder["role"];
    type: PaperOrderType;
    side: "buy" | "sell";
    price?: number;
    qty: number;
    stopPrice?: number;
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

    if (order.type === "market" && this.lastPrice != null) {
      this.fillOrder(order, this.lastPrice, false);
    }

    return order;
  }

  private checkPositionBrackets(price: number) {
    for (const pos of this.positions.all()) {
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

  private resolveContractValue(productId?: number, productSymbol?: string) {
    const key = this.leverageKey(productId, productSymbol);
    return this.contractValues.get(key) ?? 1;
  }
}
