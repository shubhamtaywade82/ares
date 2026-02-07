import { v4 as uuid } from "uuid";
import { DeltaRestClient } from "../delta/rest.client.js";
import { ExecutionRequest } from "./types.js";
import { OrderStore } from "../state/order.store.js";
import { KillSwitch } from "../risk/kill.switch.js";
import { KillReason } from "../risk/kill.reasons.js";
import { PaperExecutor } from "./paper.executor.js";

export class OrderManager {
  private pendingPaperBrackets = new Map<
    string,
    {
      symbol: string;
      side: ExecutionRequest["side"];
      stopPrice: number;
      targetPrice: number;
      qty: number;
      clientOrderId: string;
    }
  >();

  constructor(
    private rest: DeltaRestClient,
    private store: OrderStore,
    private mode: "paper" | "live",
    private paper?: PaperExecutor
  ) {}

  async execute(req: ExecutionRequest) {
    const clientOrderId = uuid();
    const set = this.store.create(clientOrderId);

    if (this.mode === "paper") {
      if (!this.paper) {
        console.warn("[ARES.PAPER] Paper executor not configured");
        return set;
      }

      const entry = this.paper.placeLimit(
        req.side === "LONG" ? "buy" : "sell",
        req.entryPrice,
        req.qty
      );
      set.entryOrderId = entry.id;
      this.pendingPaperBrackets.set(entry.id, {
        symbol: req.symbol,
        side: req.side,
        stopPrice: req.stopPrice,
        targetPrice: req.targetPrice,
        qty: req.qty,
        clientOrderId,
      });
      console.log("[ARES.PAPER] Entry submitted", req);
      return set;
    }

    console.info(
      `[ARES.EXECUTION] Submitting entry order ${req.symbol} ${req.side} qty=${req.qty}`
    );
    let entry;
    try {
      entry = await this.rest.placeOrder({
        product_symbol: req.symbol,
        side: req.side === "LONG" ? "buy" : "sell",
        type: "limit",
        price: req.entryPrice,
        size: req.qty,
        client_order_id: clientOrderId,
      });
    } catch (err) {
      KillSwitch.trigger(KillReason.EXECUTION_FAILURE, {
        stage: "ENTRY",
        error: String(err),
      });
    }

    if (!entry?.result?.id || entry?.result?.status === "rejected") {
      KillSwitch.trigger(KillReason.ORDER_REJECTED, {
        stage: "ENTRY",
        response: entry,
      });
    }

    set.entryOrderId = entry.result.id;

    let stop;
    try {
      console.info(
        `[ARES.EXECUTION] Submitting stop order ${req.symbol} ${req.side} qty=${req.qty}`
      );
      stop = await this.rest.placeOrder({
        product_symbol: req.symbol,
        side: req.side === "LONG" ? "sell" : "buy",
        type: "stop_market",
        stop_price: req.stopPrice,
        size: req.qty,
        reduce_only: true,
        client_order_id: `${clientOrderId}-SL`,
      });
    } catch (err) {
      KillSwitch.trigger(KillReason.EXECUTION_FAILURE, {
        stage: "STOP",
        error: String(err),
      });
    }

    if (!stop?.result?.id || stop?.result?.status === "rejected") {
      KillSwitch.trigger(KillReason.ORDER_REJECTED, {
        stage: "STOP",
        response: stop,
      });
    }

    set.stopOrderId = stop.result.id;

    let tp;
    try {
      console.info(
        `[ARES.EXECUTION] Submitting take-profit order ${req.symbol} ${req.side} qty=${req.qty}`
      );
      tp = await this.rest.placeOrder({
        product_symbol: req.symbol,
        side: req.side === "LONG" ? "sell" : "buy",
        type: "limit",
        price: req.targetPrice,
        size: req.qty,
        reduce_only: true,
        client_order_id: `${clientOrderId}-TP`,
      });
    } catch (err) {
      KillSwitch.trigger(KillReason.EXECUTION_FAILURE, {
        stage: "TAKE_PROFIT",
        error: String(err),
      });
    }

    if (!tp?.result?.id || tp?.result?.status === "rejected") {
      KillSwitch.trigger(KillReason.ORDER_REJECTED, {
        stage: "TAKE_PROFIT",
        response: tp,
      });
    }

    set.targetOrderId = tp.result.id;

    return set;
  }

  onPaperOrderUpdate(orderId: string, status: string) {
    if (this.mode !== "paper" || status !== "closed") return;
    const pending = this.pendingPaperBrackets.get(orderId);
    if (!pending || !this.paper) return;

    const set = this.store.get(pending.clientOrderId);
    if (!set) return;

    const stop = this.paper.placeStopMarket(
      pending.side === "LONG" ? "sell" : "buy",
      pending.stopPrice,
      pending.qty
    );
    const tp = this.paper.placeLimit(
      pending.side === "LONG" ? "sell" : "buy",
      pending.targetPrice,
      pending.qty
    );

    set.stopOrderId = stop.id;
    set.targetOrderId = tp.id;
    this.pendingPaperBrackets.delete(orderId);
    console.log("[ARES.PAPER] Bracket orders submitted");
  }
}
