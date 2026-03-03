import { v4 as uuid } from "uuid";
import { DeltaRestClient } from "../delta/rest.client.js";
import { logger } from "../utils/logger.js";
import { ExecutionRequest } from "./types.js";
import { OrderStore } from "../state/order.store.js";
import { KillSwitch } from "../risk/kill.switch.js";
import { KillReason } from "../risk/kill.reasons.js";
import { PaperExecutor } from "./paper.executor.js";
import { BracketBuilder } from "./bracket.builder.js";
import { ActivePosition } from "./trade.types.js";
import { resolveMaxLeverage } from "../config/risk.js";

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
    private paper?: PaperExecutor,
    private bracketBuilder?: BracketBuilder,
    private activePositions?: Map<string, ActivePosition>
  ) {}

  private isPostOnlyRejection(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes("post_only") || message.includes("post-only") || message.includes("would cross") || message.includes("postonly");
  }

  async execute(req: ExecutionRequest) {
    const clientOrderId = uuid();
    const set = this.store.create(clientOrderId);
    set.symbol = req.symbol;
    set.side = req.side;
    set.stopPrice = req.stopPrice;
    set.targetPrice = req.targetPrice;
    set.bracketQty = req.qty;
    set.filledQty = 0;
    if (req.signalContext) {
      set.signalContext = req.signalContext;
    }

    if (this.mode === "paper") {
      if (!this.paper) {
        logger.warn("[ARES.PAPER] Paper executor not configured");
        return set;
      }

      const leverage = resolveMaxLeverage(req.symbol);
      this.paper.setOrderLeverage(req.productId, req.symbol, leverage);

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
        : this.paper.placeLimit(req.side === "LONG" ? "buy" : "sell", req.entryPrice, req.qty, {
            ...(req.productId !== undefined ? { productId: req.productId } : {}),
            productSymbol: req.symbol,
            clientOrderId,
            role: "entry",
          });

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

    logger.info(`[ARES.EXECUTION] Submitting entry order ${req.symbol} ${req.side} qty=${req.qty}`);
    try {
      const entry = await this.rest.placeOrder({
        product_symbol: req.symbol,
        side: req.side === "LONG" ? "buy" : "sell",
        order_type: "limit_order",
        limit_price: String(req.entryPrice),
        post_only: true,
        size: req.qty,
        client_order_id: clientOrderId,
      });

      if (!entry?.result?.id || entry?.result?.status === "rejected") {
        KillSwitch.trigger(KillReason.ORDER_REJECTED, { stage: "ENTRY", response: entry });
      }
      set.entryOrderId = String(entry.result.id);
      return set;
    } catch (err) {
      if (this.isPostOnlyRejection(err)) {
        logger.warn(`[ARES.EXECUTION] Post-only rejected for ${req.symbol}; skipping entry`);
        return set;
      }
      KillSwitch.trigger(KillReason.EXECUTION_FAILURE, { stage: "ENTRY", error: String(err) });
    }
  }

  async onLiveEntryPartialFill(entryOrderId: string, filledQty: number) {
    if (this.mode !== "live") return;
    for (const set of this.store.values()) {
      if (set.entryOrderId !== entryOrderId) continue;
      set.filledQty = Math.max(set.filledQty ?? 0, filledQty);
      logger.info(`[ARES.EXECUTION] Entry partial fill tracked ${set.symbol} filled=${set.filledQty}`);
      return;
    }
  }

  async onLiveEntryFilled(entryOrderId: string, filledQty: number, avgFillPrice?: number) {
    if (this.mode !== "live") return;
    if (!this.bracketBuilder || !this.activePositions) return;

    for (const set of this.store.values()) {
      if (set.entryOrderId !== entryOrderId) continue;
      if (!set.symbol || !set.side || set.stopPrice == null || set.targetPrice == null) return;

      const side = set.side === "LONG" ? "buy" : "sell";
      const entryPrice = Number.isFinite(avgFillPrice) ? Number(avgFillPrice) : set.side === "LONG" ? set.targetPrice - (set.targetPrice - set.stopPrice) : set.targetPrice + (set.stopPrice - set.targetPrice);
      const tpDelta = Math.abs(set.targetPrice - entryPrice);
      const tp2 = side === "buy" ? entryPrice + tpDelta * 2 : entryPrice - tpDelta * 2;

      const active: ActivePosition = {
        entryOrderId,
        symbol: set.symbol.toUpperCase(),
        side,
        entryPrice,
        entryQty: filledQty,
        entryTime: Date.now(),
        filledQty,
        stage: "OPEN_FULL",
        slOrderId: null,
        tp1OrderId: null,
        tp2OrderId: null,
        slPrice: set.stopPrice,
        tp1Price: set.targetPrice,
        tp2Price: tp2,
        beSlOrderId: null,
        tp1FillQty: null,
        tp1FillPrice: null,
        tp1FilledTime: null,
        tp2FillQty: null,
        tp2FillPrice: null,
        tp2FilledTime: null,
        slFillQty: null,
        slFillPrice: null,
        slFilledTime: null,
        signal: set.signalContext ?? {
          htfBias: "UNKNOWN",
          smcScore: 0,
          rr: 0,
          reason: "n/a",
        },
      };

      const ids = await this.bracketBuilder.placeInitialBrackets(active);
      active.slOrderId = ids.slOrderId;
      active.tp1OrderId = ids.tp1OrderId;
      active.tp2OrderId = ids.tp2OrderId;
      this.activePositions.set(active.symbol, active);

      set.stopOrderId = ids.slOrderId;
      set.targetOrderId = ids.tp2OrderId;
      set.filledQty = filledQty;
      set.bracketQty = filledQty;

      logger.info(`[ARES.EXECUTION] Initial brackets placed ${active.symbol} sl:${ids.slOrderId} tp1:${ids.tp1OrderId} tp2:${ids.tp2OrderId}`);
      return;
    }
  }

  onPaperOrderUpdate(orderId: string, status: string) {
    if (this.mode !== "paper" || status !== "closed") return;
    const pending = this.pendingPaperBrackets.get(orderId);
    if (!pending || !this.paper) return;

    const set = this.store.get(pending.clientOrderId);
    if (!set) return;

    const stop = this.paper.placeStopMarket(pending.side === "LONG" ? "sell" : "buy", pending.stopPrice, pending.qty, {
      productSymbol: pending.symbol,
      clientOrderId: `${pending.clientOrderId}-SL`,
      role: "stop",
    });
    const tp = this.paper.placeLimit(pending.side === "LONG" ? "sell" : "buy", pending.targetPrice, pending.qty, {
      productSymbol: pending.symbol,
      clientOrderId: `${pending.clientOrderId}-TP`,
      role: "take_profit",
    });

    set.stopOrderId = stop.id;
    set.targetOrderId = tp.id;
    this.pendingPaperBrackets.delete(orderId);
    logger.info("[ARES.PAPER] Bracket orders submitted");
    this.paper.setPositionBrackets(undefined, pending.symbol, pending.stopPrice, pending.targetPrice);
  }
}
