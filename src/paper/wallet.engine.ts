/**
 * Paper Wallet Engine — replicates Delta Exchange India wallet accounting.
 *
 * Wallet stored in INR.  Trading math in USD.  Fixed conversion @ 85.
 *
 * Mirrors the Delta UI fields:
 *   - Account Value (equityInr)
 *   - Available Margin
 *   - Used Margin
 *   - Unrealized PnL (USD + INR)
 *   - Realized PnL (USD + INR)
 */

import { inrToUsd, usdToInr } from "../finance/fx.js";
import {
  unrealizedPnl,
  realizedPnl as computeRealizedPnl,
  totalUnrealizedPnl,
} from "../finance/pnl.engine.js";
import type {
  OpenPositionParams,
  WalletPosition,
  WalletSnapshot,
} from "../finance/types.js";

export class PaperWalletEngine {
  private balanceInr: number;
  private realizedPnlUsd = 0;
  private realizedPnlInr = 0;
  private positions: WalletPosition[] = [];

  constructor(initialBalanceInr: number) {
    this.balanceInr = initialBalanceInr;
  }

  // ── Queries ────────────────────────────────────────────────────────

  /** Take an immutable snapshot (matches the Delta UI fields). */
  snapshot(): WalletSnapshot {
    const { pnlUsd: unrealizedUsd, pnlInr: unrealizedInr } =
      totalUnrealizedPnl(this.positions);

    const equityInr = this.balanceInr + unrealizedInr;
    const usedMarginInr = this.computeUsedMargin();
    const availableMarginInr = equityInr - usedMarginInr;

    return {
      currency: "INR",
      balanceInr: this.balanceInr,
      equityInr,
      usedMarginInr,
      availableMarginInr,
      unrealizedPnlUsd: unrealizedUsd,
      unrealizedPnlInr: unrealizedInr,
      realizedPnlUsd: this.realizedPnlUsd,
      realizedPnlInr: this.realizedPnlInr,
      positions: [...this.positions],
    };
  }

  /** Get a specific position by symbol. */
  getPosition(symbol: string): WalletPosition | undefined {
    return this.positions.find(
      (p) => p.symbol.toUpperCase() === symbol.toUpperCase()
    );
  }

  /** USD equivalent of the INR balance. */
  get balanceUsd(): number {
    return inrToUsd(this.balanceInr);
  }

  // ── Mutations ──────────────────────────────────────────────────────

  /** Open a new position (or add to an existing same-side position). */
  openPosition(params: OpenPositionParams): void {
    const existing = this.getPosition(params.symbol);

    if (existing && existing.side === params.side) {
      // Average-in: weighted entry price
      const totalQty = existing.contracts + params.contracts;
      existing.entryPrice =
        (existing.entryPrice * existing.contracts +
          params.entryPrice * params.contracts) /
        totalQty;
      existing.contracts = totalQty;
      return;
    }

    if (existing && existing.side !== params.side) {
      // Opposing side — close existing first, then open remainder
      this.closePosition(params.symbol, params.entryPrice);
    }

    const marginUsd =
      (params.contracts * params.contractValue * params.entryPrice) /
      params.leverage;
    const marginInr = usdToInr(marginUsd);

    const snap = this.snapshot();
    if (marginInr > snap.availableMarginInr) {
      throw new Error(
        `Insufficient margin: need ₹${marginInr.toFixed(2)}, available ₹${snap.availableMarginInr.toFixed(2)}`
      );
    }

    this.positions.push({
      symbol: params.symbol,
      productId: params.productId,
      side: params.side,
      contracts: params.contracts,
      entryPrice: params.entryPrice,
      markPrice: params.entryPrice,
      contractValue: params.contractValue,
    });
  }

  /** Update mark price for a symbol (called on every tick). */
  updateMark(symbol: string, markPrice: number): void {
    const pos = this.getPosition(symbol);
    if (!pos) return;
    pos.markPrice = markPrice;
  }

  /** Close a position and settle realized PnL. */
  closePosition(symbol: string, exitPrice?: number): void {
    const idx = this.positions.findIndex(
      (p) => p.symbol.toUpperCase() === symbol.toUpperCase()
    );
    if (idx === -1) return;

    const pos = this.positions[idx]!;
    const price = exitPrice ?? pos.markPrice;

    const { pnlUsd, pnlInr } = computeRealizedPnl(
      pos.side,
      pos.entryPrice,
      price,
      pos.contracts,
      pos.contractValue
    );

    this.realizedPnlUsd += pnlUsd;
    this.realizedPnlInr += pnlInr;
    this.balanceInr += pnlInr;

    this.positions.splice(idx, 1);
  }

  /** Close all open positions at their current mark prices. */
  closeAll(): void {
    // Iterate in reverse to avoid index shifts
    for (let i = this.positions.length - 1; i >= 0; i--) {
      const pos = this.positions[i]!;
      this.closePosition(pos.symbol);
    }
  }

  /** Deduct a fee (in USD) from the wallet balance. */
  deductFeeUsd(feeUsd: number): void {
    this.balanceInr -= usdToInr(feeUsd);
  }

  /** Deduct a fee (in INR) from the wallet balance. */
  deductFeeInr(feeInr: number): void {
    this.balanceInr -= feeInr;
  }

  // ── Internal ───────────────────────────────────────────────────────

  /**
   * Compute total used margin across all positions.
   *
   * Used margin = sum of (notional / leverage) per position.
   * We store leverage implicitly from the entry — for paper trading
   * we default to 10x if not tracked separately.
   */
  private computeUsedMargin(): number {
    let total = 0;
    for (const pos of this.positions) {
      // Notional in USD
      const notionalUsd =
        pos.contracts * pos.contractValue * pos.entryPrice;
      // Default leverage 10x for paper wallet; real leverage is tracked by
      // the execution layer when opening positions.
      const leverage = 10;
      total += usdToInr(notionalUsd / leverage);
    }
    return total;
  }
}
