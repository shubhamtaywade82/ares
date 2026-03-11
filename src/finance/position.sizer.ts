/**
 * Position sizer — computes contract quantity with INR wallet awareness.
 *
 * Wallet balance is INR → convert to USD for risk math → size in contracts.
 * Pure function — no I/O, no state.
 */

import { inrToUsd, usdToInr } from "./fx.js";
import type { PositionSizeInput, PositionSizeOutput } from "./types.js";

/**
 * Calculate safe position size given an INR-denominated wallet.
 *
 * Steps:
 *   1. Risk budget: equityInr * riskPct → convert to USD
 *   2. Stop distance: |entry - stop|
 *   3. Raw qty: riskUsd / (stopDistance * contractValue)
 *   4. Max qty from leverage cap: (availableMarginInr→USD * maxLeverage) / (entry * contractValue)
 *   5. Apply safety buffer (default 95%)
 *   6. Align to minLotSize
 *
 * Returns `null` if the sized quantity falls below minLotSize.
 */
export function calculatePositionSize(
  input: PositionSizeInput
): PositionSizeOutput | null {
  const safetyBuffer = input.safetyBuffer ?? 0.95;

  const riskInr = input.equityInr * input.riskPct;
  const riskUsd = inrToUsd(riskInr);

  const stopDistanceUsd = Math.abs(input.entryPrice - input.stopPrice);
  if (stopDistanceUsd <= 0) return null;

  // Qty from risk budget
  const rawQty = riskUsd / (stopDistanceUsd * input.contractValue);

  // Qty ceiling from leverage cap
  const availableUsd = inrToUsd(input.availableMarginInr);
  const maxNotionalUsd = availableUsd * input.maxLeverage;
  const maxQty = maxNotionalUsd / (input.entryPrice * input.contractValue);

  // Apply safety buffer and align
  const sizedQty = Math.min(rawQty, maxQty) * safetyBuffer;

  if (sizedQty < input.minLotSize) return null;

  const contracts =
    Math.floor(sizedQty / input.minLotSize) * input.minLotSize;

  if (contracts < input.minLotSize) return null;

  const notionalUsd = contracts * input.contractValue * input.entryPrice;

  return {
    contracts,
    riskUsd,
    riskInr,
    notionalUsd,
    notionalInr: usdToInr(notionalUsd),
    stopDistanceUsd,
  };
}
