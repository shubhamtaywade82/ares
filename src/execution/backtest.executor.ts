/**
 * Backtest Execution Adapter — deterministic simulated fills for historical replay.
 *
 * Design rules:
 *   - All fills are immediate (no pending order queue needed).
 *   - Slippage is applied as a fixed fraction of the fill price.
 *   - Fees are computed via the fee engine (commission + GST).
 *   - Entry orders are treated as maker by default; exits as taker.
 *   - No external I/O — all state is in-memory.
 *   - Call reset() between independent backtest runs.
 */

import { v4 as uuid } from "uuid";
import {
  computeFee,
  computeNotionalInr,
  type FeeOrderType,
} from "../finance/feeEngine.js";
import type {
  ExecutionAdapter,
  Order,
  OrderResult,
  AdapterPosition,
} from "./adapter.js";

// ── Configuration ──────────────────────────────────────────────────────────────

export interface BacktestConfig {
  /**
   * Slippage fraction applied to every fill price.
   * Buy orders pay fillPrice × (1 + slippagePct).
   * Sell orders receive fillPrice × (1 - slippagePct).
   * Default: 0.0005 (0.05%).
   */
  slippagePct?: number | undefined;
  /**
   * USD/INR rate used for fee conversion.
   * Delta India fixed rate. Default: 85.
   */
  usdInrRate?: number | undefined;
  /**
   * Value of one contract in the underlying asset (e.g. 0.001 for BTCUSD).
   * Default: 1. Override per-symbol via setContractValue().
   */
  defaultContractValue?: number | undefined;
  /**
   * When true, entry orders are filled as maker (limit); exits as taker.
   * Reflects typical scalp strategy post-only entry behaviour.
   * Default: true.
   */
  assumeMakerEntry?: boolean | undefined;
}

// ── Internal position ──────────────────────────────────────────────────────────

interface BacktestPosition extends AdapterPosition {
  contractValue: number;
}

// ── Executor ───────────────────────────────────────────────────────────────────

/**
 * Implements ExecutionAdapter for deterministic backtest replay.
 *
 * Usage:
 *   const exec = new BacktestExecutor({ slippagePct: 0.0005 });
 *   exec.setContractValue("ETHUSD", 0.01);
 *   exec.setMarkPrice("ETHUSD", 3000);
 *   await exec.placeOrder({ symbol: "ETHUSD", side: "buy", type: "limit", price: 3000, qty: 200 });
 */
export class BacktestExecutor implements ExecutionAdapter {
  private readonly slippagePct: number;
  private readonly usdInrRate: number;
  private readonly defaultContractValue: number;
  private readonly assumeMakerEntry: boolean;

  private positions = new Map<string, BacktestPosition>();
  private contractValues = new Map<string, number>();
  private markPrices = new Map<string, number>();

  /** Cumulative fees charged in INR across this run. */
  totalFeesInr = 0;

  /** Cumulative realized PnL in USD across this run. */
  totalRealizedPnlUsd = 0;

  constructor(config: BacktestConfig = {}) {
    this.slippagePct = config.slippagePct ?? 0.0005;
    this.usdInrRate = config.usdInrRate ?? 85;
    this.defaultContractValue = config.defaultContractValue ?? 1;
    this.assumeMakerEntry = config.assumeMakerEntry ?? true;
  }

  // ── Configuration helpers ────────────────────────────────────────────────────

  /** Register the contract value for a symbol (call before placing orders). */
  setContractValue(symbol: string, contractValue: number): void {
    this.contractValues.set(symbol.toUpperCase(), contractValue);
  }

  /**
   * Update the reference mark price for a symbol.
   * Called by the replay engine on each candle/tick so market orders and
   * stop-market fills use the current price.
   */
  setMarkPrice(symbol: string, markPrice: number): void {
    const key = symbol.toUpperCase();
    this.markPrices.set(key, markPrice);
    const pos = this.positions.get(key);
    if (pos) pos.markPrice = markPrice;
  }

  // ── ExecutionAdapter ─────────────────────────────────────────────────────────

  async placeOrder(order: Order): Promise<OrderResult> {
    const key = order.symbol.toUpperCase();
    const contractValue = this.contractValues.get(key) ?? this.defaultContractValue;
    const markPrice = this.markPrices.get(key) ?? 0;

    // Resolve reference price for the fill
    const refPrice =
      order.type === "stop_market"
        ? (order.stopPrice ?? markPrice)
        : (order.price ?? markPrice);

    if (refPrice <= 0) {
      return { orderId: uuid(), status: "rejected" };
    }

    // Apply slippage
    const slippageDir = order.side === "buy" ? 1 : -1;
    const fillPrice = refPrice * (1 + slippageDir * this.slippagePct);

    // Determine maker/taker based on whether this is an entry or an exit
    const existingPos = this.positions.get(key);
    const isEntry =
      !existingPos ||
      (existingPos.side === "LONG") === (order.side === "sell")
        ? false  // closing an existing position → taker
        : true;  // opening new position → respect assumeMakerEntry

    const orderType: FeeOrderType =
      isEntry && this.assumeMakerEntry ? "maker" : "taker";

    // Compute fee
    const notionalInr = computeNotionalInr(
      order.qty,
      contractValue,
      fillPrice,
      this.usdInrRate
    );
    const feeInr = computeFee(notionalInr, orderType);
    this.totalFeesInr += feeInr;

    // Update positions
    this.applyFill(key, order, fillPrice, contractValue);

    return {
      orderId: uuid(),
      status: "filled",
      fillPrice,
      fillQty: order.qty,
      feeInr,
    };
  }

  async cancelOrder(_orderId: string): Promise<void> {
    // Backtest: all fills are immediate — no pending orders exist to cancel.
  }

  async getPositions(): Promise<AdapterPosition[]> {
    return Array.from(this.positions.values()).map(
      ({ contractValue: _cv, ...pos }) => pos
    );
  }

  // ── State management ─────────────────────────────────────────────────────────

  /** Reset all run state. Call between independent backtest runs. */
  reset(): void {
    this.positions.clear();
    this.markPrices.clear();
    this.totalFeesInr = 0;
    this.totalRealizedPnlUsd = 0;
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private applyFill(
    key: string,
    order: Order,
    fillPrice: number,
    contractValue: number
  ): void {
    const fillSide: "LONG" | "SHORT" = order.side === "buy" ? "LONG" : "SHORT";
    const existing = this.positions.get(key);

    if (!existing) {
      // Open a new position
      this.positions.set(key, {
        symbol: key,
        productId: order.productId,
        side: fillSide,
        qty: order.qty,
        entryPrice: fillPrice,
        markPrice: fillPrice,
        contractValue,
      });
      return;
    }

    if (existing.side === fillSide) {
      // Add to existing position — compute weighted average entry
      const total = existing.qty + order.qty;
      existing.entryPrice =
        (existing.entryPrice * existing.qty + fillPrice * order.qty) / total;
      existing.qty = total;
      return;
    }

    // Closing or reversing — realize PnL
    const closingQty = Math.min(existing.qty, order.qty);
    const pnlUsd =
      existing.side === "LONG"
        ? (fillPrice - existing.entryPrice) * closingQty * existing.contractValue
        : (existing.entryPrice - fillPrice) * closingQty * existing.contractValue;
    this.totalRealizedPnlUsd += pnlUsd;

    if (order.qty < existing.qty) {
      // Partial close
      existing.qty -= order.qty;
    } else if (order.qty === existing.qty) {
      // Full close
      this.positions.delete(key);
    } else {
      // Close and reverse
      const remainQty = order.qty - existing.qty;
      this.positions.set(key, {
        symbol: key,
        productId: order.productId,
        side: fillSide,
        qty: remainQty,
        entryPrice: fillPrice,
        markPrice: fillPrice,
        contractValue: existing.contractValue,
      });
    }
  }
}
