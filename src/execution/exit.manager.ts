import { v4 as uuid } from "uuid";
import { DeltaRestClient } from "../delta/rest.client.js";
import { logger } from "../utils/logger.js";
import { BracketBuilder } from "./bracket.builder.js";
import { calculatePnl, calculateRMultiple } from "./pnl.js";
import { TradeJournal } from "./trade.journal.js";
import { ActivePosition, ExitReason, TradeRecord } from "./trade.types.js";

interface ExitDependencies {
  isDailyLossBreached: () => boolean;
  recordTrade: (pnl: number) => void;
  activateKillSwitch: (reason: string) => void;
  resolveContractValue: (symbol: string) => number;
}

export class ExitManager {
  private reentryBlocked = new Set<string>();
  private processingFills = new Set<string>();

  constructor(
    private delta: DeltaRestClient,
    private brackets: BracketBuilder,
    private journal: TradeJournal,
    private positions: Map<string, ActivePosition>,
    private deps: ExitDependencies
  ) {}

  async onBracketFill(orderId: string, filledQty: number, fillPrice: number): Promise<void> {
    const pos = this.findByBracketId(orderId);
    if (!pos) return;

    const symbol = pos.symbol.toUpperCase();
    if (this.processingFills.has(symbol)) {
      logger.warn(`[ARES.EXECUTION] Concurrent fill ignored for ${symbol}`);
      return;
    }

    this.processingFills.add(symbol);
    try {
      if (orderId === pos.tp1OrderId) {
        await this.onTP1(pos, filledQty, fillPrice);
        return;
      }
      if (orderId === pos.tp2OrderId) {
        await this.onTP2(pos, filledQty, fillPrice);
        return;
      }
      if (orderId === pos.slOrderId || orderId === pos.beSlOrderId) {
        await this.onSL(pos, filledQty, fillPrice);
      }
    } finally {
      this.processingFills.delete(symbol);
    }
  }

  isBracketOrder(orderId: string): boolean {
    return this.findByBracketId(orderId) !== undefined;
  }

  canReenter(symbol: string): boolean {
    return !this.reentryBlocked.has(symbol.toUpperCase());
  }

  clearReentryBlock(symbol: string): void {
    this.reentryBlocked.delete(symbol.toUpperCase());
  }

  async reconcileOnBoot(
    openPositions: Array<Record<string, unknown>>,
    openOrders: Array<Record<string, unknown>>,
    closeOrphaned: boolean,
    closePosition: (symbol: string) => Promise<void>
  ): Promise<void> {
    for (const pos of openPositions) {
      const symbol = String(pos.product_symbol ?? pos.symbol ?? "").toUpperCase();
      const rawSize = Number(pos.size ?? 0);
      const size = Math.abs(rawSize);
      if (!symbol || !Number.isFinite(size) || size <= 0) continue;

      const brackets = openOrders.filter(
        (order) =>
          String(order.product_symbol ?? order.symbol ?? "").toUpperCase() === symbol &&
          Boolean(order.reduce_only ?? order.reduceOnly)
      );

      if (brackets.length === 0) {
        if (closeOrphaned) {
          logger.warn(`[ARES.EXECUTION] Orphaned position — closing: ${symbol}`);
          await closePosition(symbol);
        } else {
          this.deps.activateKillSwitch("orphaned unprotected position on boot");
        }
        continue;
      }

      const sl = brackets.find((order) => {
        const type = String(order.order_type ?? "");
        return type === "stop_limit_order" || type === "stop_market_order";
      });
      const tps = brackets
        .filter((order) => String(order.order_type ?? "") === "limit_order")
        .sort((a, b) => Number(a.limit_price ?? 0) - Number(b.limit_price ?? 0));

      const adopted: ActivePosition = {
        entryOrderId: "reconciled",
        symbol,
        side: rawSize > 0 ? "buy" : "sell",
        entryPrice: Number(pos.entry_price ?? 0),
        entryQty: size,
        filledQty: size,
        entryTime: Date.now(),
        stage: tps.length === 1 ? "OPEN_PARTIAL" : "OPEN_FULL",
        slPrice: Number(sl?.stop_price ?? 0),
        tp1Price: Number(tps[0]?.limit_price ?? 0),
        tp2Price: Number(tps[1]?.limit_price ?? 0),
        slOrderId: sl?.id ? String(sl.id) : null,
        tp1OrderId: tps[0]?.id ? String(tps[0].id) : null,
        tp2OrderId: tps[1]?.id ? String(tps[1].id) : null,
        beSlOrderId: null,
        tp1FillPrice: null,
        tp1FillQty: null,
        tp1FilledTime: null,
        tp2FillPrice: null,
        tp2FillQty: null,
        tp2FilledTime: null,
        slFillPrice: null,
        slFillQty: null,
        slFilledTime: null,
        signal: { htfBias: "UNKNOWN", smcScore: 0, rr: 0, reason: "reconciled" },
      };

      this.positions.set(symbol, adopted);
      logger.info(`[ARES.EXECUTION] Position adopted: ${symbol} stage:${adopted.stage}`);
    }
  }

  private async onTP1(pos: ActivePosition, qty: number, price: number): Promise<void> {
    logger.info(`[ARES.EXECUTION] TP1 filled — ${pos.symbol} qty:${qty} @ ${price}`);
    pos.stage = "OPEN_PARTIAL";
    pos.tp1FillPrice = price;
    pos.tp1FillQty = qty;
    pos.tp1FilledTime = Date.now();
    pos.tp1OrderId = null;

    await this.cancelSafely(pos.slOrderId, "SL after TP1");
    pos.slOrderId = null;

    const cv = this.deps.resolveContractValue(pos.symbol);
    const remainingQty = await this.brackets.fetchRemainingQty(pos.symbol);
    if (remainingQty <= 0) {
      logger.warn(`[ARES.EXECUTION] Remaining qty is zero after TP1 fill for ${pos.symbol}`);
      const pnl = calculatePnl(pos.side, pos.entryPrice, price, qty, cv);
      await this.closeOut(pos, "TP2", price, pnl);
      return;
    }

    if (pos.tp2OrderId) {
      await this.cancelSafely(pos.tp2OrderId, "TP2 resize after TP1");
      const tp2 = await this.delta.placeOrder({
        product_symbol: pos.symbol,
        size: remainingQty,
        side: pos.side === "buy" ? "sell" : "buy",
        order_type: "limit_order",
        limit_price: String(pos.tp2Price),
        reduce_only: true,
      });
      pos.tp2OrderId = String(tp2.result.id);
    }

    pos.beSlOrderId = await this.brackets.placeBreakevenSl(pos, remainingQty);
    const partialPnl = calculatePnl(pos.side, pos.entryPrice, price, qty, cv);
    logger.info(
      `[ARES.EXECUTION] Breakeven SL placed @ ${pos.entryPrice} | Partial PnL:${partialPnl.toFixed(2)} USDT`
    );
  }

  private async onTP2(pos: ActivePosition, qty: number, price: number): Promise<void> {
    logger.info(`[ARES.EXECUTION] TP2 filled — ${pos.symbol} qty:${qty} @ ${price}`);
    pos.tp2FillPrice = price;
    pos.tp2FillQty = qty;
    pos.tp2FilledTime = Date.now();
    pos.tp2OrderId = null;

    await this.cancelSafely(pos.beSlOrderId ?? pos.slOrderId, "SL after TP2");
    pos.beSlOrderId = null;
    pos.slOrderId = null;

    const cv = this.deps.resolveContractValue(pos.symbol);
    const pnl = calculatePnl(pos.side, pos.entryPrice, price, qty, cv);
    await this.closeOut(pos, "TP2", price, pnl);
  }

  private async onSL(pos: ActivePosition, qty: number, price: number): Promise<void> {
    logger.warn(`[ARES.EXECUTION] SL filled — ${pos.symbol} qty:${qty} @ ${price}`);
    pos.slFillPrice = price;
    pos.slFillQty = qty;
    pos.slFilledTime = Date.now();

    await Promise.allSettled([
      this.cancelSafely(pos.tp1OrderId, "TP1 after SL"),
      this.cancelSafely(pos.tp2OrderId, "TP2 after SL"),
      this.cancelSafely(pos.beSlOrderId, "BE-SL after SL"),
    ]);

    pos.tp1OrderId = null;
    pos.tp2OrderId = null;
    pos.beSlOrderId = null;

    const cv = this.deps.resolveContractValue(pos.symbol);
    const pnl = calculatePnl(pos.side, pos.entryPrice, price, qty, cv);
    await this.closeOut(pos, "SL", price, pnl);

    if (this.deps.isDailyLossBreached()) {
      logger.error("[ARES.RISK] MAX_DAILY_LOSS breached — activating kill switch");
      this.deps.activateKillSwitch("MAX_DAILY_LOSS after SL");
    }
  }

  private async closeOut(
    pos: ActivePosition,
    reason: ExitReason,
    exitPrice: number,
    pnl: number
  ): Promise<void> {
    await this.verifyFlat(pos.symbol);
    this.deps.recordTrade(pnl);

    const cv = this.deps.resolveContractValue(pos.symbol);
    const riskUsdt = Math.abs(pos.entryPrice - pos.slPrice) * pos.entryQty * cv;
    const record: TradeRecord = {
      id: uuid(),
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      entryQty: pos.entryQty,
      entryTime: pos.entryTime,
      tp1Price: pos.tp1Price,
      tp1FilledPrice: pos.tp1FillPrice,
      tp1FilledQty: pos.tp1FillQty,
      tp1FilledTime: pos.tp1FilledTime,
      tp2Price: pos.tp2Price,
      tp2FilledPrice: pos.tp2FillPrice,
      tp2FilledQty: pos.tp2FillQty,
      tp2FilledTime: pos.tp2FilledTime,
      slPrice: pos.slPrice,
      slFilledPrice: pos.slFillPrice,
      slFilledQty: pos.slFillQty,
      slFilledTime: pos.slFilledTime,
      exitReason: reason,
      realizedPnl: pnl,
      rMultiple: calculateRMultiple(pnl, riskUsdt),
      closedTime: Date.now(),
      signal: pos.signal,
      entryOrderId: pos.entryOrderId,
      slOrderId: pos.slOrderId,
      tp1OrderId: pos.tp1OrderId,
      tp2OrderId: pos.tp2OrderId,
    };

    this.journal.write(record);
    this.positions.delete(pos.symbol.toUpperCase());
    this.reentryBlocked.add(pos.symbol.toUpperCase());
    logger.info(`[ARES.EXECUTION] Closed — ${pos.symbol} reason:${reason} PnL:${pnl.toFixed(2)} USDT`);
  }

  private async verifyFlat(symbol: string): Promise<void> {
    const positionsRes = await this.delta.getPositions();
    const positions = Array.isArray(positionsRes?.result) ? positionsRes.result : [];
    const open = positions.find(
      (pos: Record<string, unknown>) =>
        String(pos.product_symbol ?? pos.symbol ?? "").toUpperCase() === symbol.toUpperCase()
    );

    if (open && Math.abs(Number(open.size ?? 0)) > 0) {
      logger.error(`[ARES.EXECUTION] Not flat after close — size:${String(open.size)} — re-registering`);
      const existing = this.positions.get(symbol.toUpperCase());
      if (existing) {
        existing.stage = "OPEN_FULL";
        this.positions.set(symbol.toUpperCase(), existing);
      }
    }
  }

  private async cancelSafely(orderId: string | null, context: string): Promise<void> {
    if (!orderId) return;
    await this.delta.cancelOrder(orderId).catch((err) => {
      logger.error(`[ARES.EXECUTION] Cancel failed (${context}): ${String(err)}`);
    });
  }

  private findByBracketId(orderId: string): ActivePosition | undefined {
    for (const pos of this.positions.values()) {
      if ([pos.slOrderId, pos.tp1OrderId, pos.tp2OrderId, pos.beSlOrderId].includes(orderId)) {
        return pos;
      }
    }
    return undefined;
  }
}
