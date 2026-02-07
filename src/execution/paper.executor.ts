import { v4 as uuid } from "uuid";
import { PAPER_CONFIG } from "../config/paper.js";
import { PaperOrder } from "./paper/types.js";
import { PositionStore } from "../state/position.store.js";
import { PnlTracker } from "../state/pnl.tracker.js";

type OrderUpdateHandler = (orderId: string, status: string) => void;

export class PaperExecutor {
  private orders = new Map<string, PaperOrder>();
  private onOrderUpdate?: OrderUpdateHandler;

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

  placeLimit(side: "buy" | "sell", price: number, qty: number): PaperOrder {
    const order: PaperOrder = {
      id: uuid(),
      type: "limit",
      side,
      price,
      qty,
      filledQty: 0,
      status: "open",
    };

    this.orders.set(order.id, order);
    return order;
  }

  placeStopMarket(
    side: "buy" | "sell",
    stopPrice: number,
    qty: number
  ): PaperOrder {
    const order: PaperOrder = {
      id: uuid(),
      type: "stop_market",
      side,
      stopPrice,
      qty,
      filledQty: 0,
      status: "open",
    };

    this.orders.set(order.id, order);
    return order;
  }

  cancel(orderId: string) {
    const order = this.orders.get(orderId);
    if (!order) return;
    order.status = "cancelled";
    this.orders.delete(orderId);
  }

  onTick(price: number) {
    for (const order of this.orders.values()) {
      if (order.status !== "open") continue;

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
    order.status = order.filledQty >= order.qty ? "filled" : "open";

    const feePct = isMaker
      ? PAPER_CONFIG.makerFeePct
      : PAPER_CONFIG.takerFeePct;

    const fee = fillPrice * fillQty * feePct;

    this.applyFill(order.side, fillPrice, fillQty, fee);

    if (order.status === "filled") {
      this.onOrderUpdate?.(order.id, "closed");
    }
  }

  private applyFill(
    side: "buy" | "sell",
    price: number,
    qty: number,
    fee: number
  ) {
    if (!this.positions.isOpen) {
      this.positions.open({
        side: side === "buy" ? "LONG" : "SHORT",
        qty,
        entryPrice: price,
      });
      return;
    }

    const pos = this.positions.current!;
    const pnl =
      pos.side === "LONG"
        ? (price - pos.entryPrice) * qty
        : (pos.entryPrice - price) * qty;

    this.pnl.record(pnl - fee);
    this.positions.close();
  }
}
