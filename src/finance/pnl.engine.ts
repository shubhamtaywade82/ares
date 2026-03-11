/**
 * PnL engine — dual-currency (USD + INR) PnL calculations for Delta India.
 *
 * Pure functions — no I/O, no state.
 */

import { usdToInr } from "./fx.js";
import type { PnlResult, PositionSide, WalletPosition } from "./types.js";

/**
 * Compute unrealized PnL for a single position.
 *
 *   LONG:  PnL = contracts * contractValue * (mark - entry)
 *   SHORT: PnL = contracts * contractValue * (entry - mark)
 */
export function unrealizedPnl(position: WalletPosition): PnlResult {
  const diff =
    position.side === "LONG"
      ? position.markPrice - position.entryPrice
      : position.entryPrice - position.markPrice;

  const pnlUsd = position.contracts * position.contractValue * diff;
  return { pnlUsd, pnlInr: usdToInr(pnlUsd) };
}

/**
 * Compute realized PnL when closing (fully or partially).
 *
 * @param side       Position side
 * @param entryPrice Entry price in USD
 * @param exitPrice  Exit/fill price in USD
 * @param contracts  Number of contracts being closed
 * @param contractValue Value of one contract in the underlying
 */
export function realizedPnl(
  side: PositionSide,
  entryPrice: number,
  exitPrice: number,
  contracts: number,
  contractValue: number
): PnlResult {
  const diff =
    side === "LONG" ? exitPrice - entryPrice : entryPrice - exitPrice;

  const pnlUsd = contracts * contractValue * diff;
  return { pnlUsd, pnlInr: usdToInr(pnlUsd) };
}

/**
 * Aggregate unrealized PnL across multiple positions.
 */
export function totalUnrealizedPnl(positions: readonly WalletPosition[]): PnlResult {
  let totalUsd = 0;
  for (const pos of positions) {
    const { pnlUsd } = unrealizedPnl(pos);
    totalUsd += pnlUsd;
  }
  return { pnlUsd: totalUsd, pnlInr: usdToInr(totalUsd) };
}
