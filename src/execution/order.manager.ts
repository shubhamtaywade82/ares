import { v4 as uuid } from "uuid";
import { DeltaRestClient } from "../delta/rest.client.js";
import { logger } from "../utils/logger.js";
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
        logger.warn("[ARES.PAPER] Paper executor not configured");
        return set;
      }

      const useMarket = req.useMarketEntry === true;
      const entry = useMarket
        ? this.paper.placeOrder({
            ...(req.productId !== undefined ? { product_id: req.productId } : {}),
            product_symbol: req.symbol,
            size: req.qty,
            side: req.side === "LONG" ? "buy" : "sell",
            order_type: "market",
            client_order_id: clientOrderId,
          })
        : this.paper.placeLimit(
            req.side === "LONG" ? "buy" : "sell",
            req.entryPrice,
            req.qty,
            {
              ...(req.productId !== undefined ? { productId: req.productId } : {}),
              productSymbol: req.symbol,
              clientOrderId,
              role: "entry",
            }
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
      logger.info(req, "[ARES.PAPER] Entry submitted");
      return set;
    }

    logger.info(
      `[ARES.EXECUTION] Submitting entry order ${req.symbol} ${req.side} qty=${req.qty}`
    );
    let entry;
    try {
      entry = await this.rest.placeOrder({
        product_symbol: req.symbol,
        side: req.side === "LONG" ? "buy" : "sell",
        order_type: "limit_order",
        limit_price: String(req.entryPrice),
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

    set.entryOrderId = String(entry.result.id);

    let stop;
    try {
      logger.info(
        `[ARES.EXECUTION] Submitting stop order ${req.symbol} ${req.side} qty=${req.qty}`
      );
      stop = await this.rest.placeOrder({
        product_symbol: req.symbol,
        side: req.side === "LONG" ? "sell" : "buy",
        order_type: "limit_order",
        stop_order_type: "stop_loss_order",
        stop_price: String(req.stopPrice),
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

    set.stopOrderId = String(stop.result.id);

    let tp;
    try {
      logger.info(
        `[ARES.EXECUTION] Submitting take-profit order ${req.symbol} ${req.side} qty=${req.qty}`
      );
      tp = await this.rest.placeOrder({
        product_symbol: req.symbol,
        side: req.side === "LONG" ? "sell" : "buy",
        order_type: "limit_order",
        limit_price: String(req.targetPrice),
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

    set.targetOrderId = String(tp.result.id);

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
      pending.qty,
      {
        productSymbol: pending.symbol,
        clientOrderId: `${pending.clientOrderId}-SL`,
        role: "stop",
      }
    );
    const tp = this.paper.placeLimit(
      pending.side === "LONG" ? "sell" : "buy",
      pending.targetPrice,
      pending.qty,
      {
        productSymbol: pending.symbol,
        clientOrderId: `${pending.clientOrderId}-TP`,
        role: "take_profit",
      }
    );

    set.stopOrderId = stop.id;
    set.targetOrderId = tp.id;
    this.pendingPaperBrackets.delete(orderId);
    logger.info("[ARES.PAPER] Bracket orders submitted");
    this.paper.setPositionBrackets(
      undefined,
      pending.symbol,
      pending.stopPrice,
      pending.targetPrice
    );
  }
}
