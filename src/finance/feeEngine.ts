/**
 * Fee Engine — Delta Exchange India trading cost simulation.
 *
 * Implements the complete Delta India fee model:
 *   - Maker / Taker trading commission
 *   - 18% GST on trading fees
 *   - Funding fee for perpetual contracts (charged every 8h)
 *   - Round-trip (entry + exit) cost
 *   - Break-even price move calculation
 *
 * All monetary outputs are in INR unless the function name says "Usd".
 * Pure functions — no I/O, no state.
 */

import { usdToInr } from "./fx.js";

// ── Fee constants ──────────────────────────────────────────────────────────────

/** Maker fee rate: 0.02% — limit orders that add liquidity. */
export const MAKER_FEE_RATE = 0.0002 as const;

/** Taker fee rate: 0.05% — market orders that remove liquidity. */
export const TAKER_FEE_RATE = 0.0005 as const;

/** GST rate applied on top of every trading fee in India: 18%. */
export const GST_RATE = 0.18 as const;

/** Order fill type — determines which fee rate applies. */
export type FeeOrderType = "maker" | "taker";

// ── Core fee functions ─────────────────────────────────────────────────────────

/**
 * Compute the notional position value in INR.
 *
 *   notional = contracts × contractSize × priceUsd × usdInrRate
 *
 * @param contracts     Number of contracts traded
 * @param contractSize  Size of one contract in the underlying (e.g. 0.01 ETH)
 * @param priceUsd      Mark / fill price in USD
 * @param usdInrRate    USD/INR rate (Delta India fixed rate = 85)
 * @returns             Notional in INR
 */
export function computeNotionalInr(
  contracts: number,
  contractSize: number,
  priceUsd: number,
  usdInrRate = 85
): number {
  return contracts * contractSize * priceUsd * usdInrRate;
}

/**
 * Compute single-leg trading fee (commission + GST) in INR.
 *
 *   fee      = notionalInr × rate
 *   gst      = fee × 0.18
 *   totalFee = fee + gst
 *
 * @param notionalInr  Position notional in INR
 * @param type         Fill type — "maker" (limit) or "taker" (market)
 * @returns            Total fee in INR including GST
 *
 * @example
 * // ETH: 200 contracts × 0.01 ETH × $3000 × 85 = ₹510 000
 * computeFee(510_000, "maker")  // → ₹120.36
 * computeFee(510_000, "taker")  // → ₹300.90
 */
export function computeFee(notionalInr: number, type: FeeOrderType): number {
  const rate = type === "maker" ? MAKER_FEE_RATE : TAKER_FEE_RATE;
  const fee = notionalInr * rate;
  const gst = fee * GST_RATE;
  return fee + gst;
}

/**
 * Compute round-trip trade cost (entry fee + exit fee) in INR.
 *
 * @param notionalInr  Position notional in INR (same for both legs)
 * @param entryType    Fill type for the entry order
 * @param exitType     Fill type for the exit order
 * @returns            Total round-trip fee in INR
 *
 * @example
 * computeRoundTripFee(510_000, "maker", "maker")  // → ₹240.72
 * computeRoundTripFee(510_000, "taker", "taker")  // → ₹601.80
 */
export function computeRoundTripFee(
  notionalInr: number,
  entryType: FeeOrderType,
  exitType: FeeOrderType
): number {
  return computeFee(notionalInr, entryType) + computeFee(notionalInr, exitType);
}

/**
 * Compute perpetual contract funding fee in INR.
 *
 * Delta Exchange charges funding every 8 hours.
 * Positive fundingRate → position holder pays; negative → position holder receives.
 *
 *   fundingFeeUsd = notionalUsd × fundingRate
 *   fundingFeeInr = fundingFeeUsd × USD_INR
 *
 * @param notionalUsd   Position notional in USD (contracts × contractSize × markPrice)
 * @param fundingRate   Current funding rate as a decimal (e.g. 0.0001 = 0.01%)
 * @returns             Funding fee in INR (positive = cost to holder, negative = income)
 *
 * @example
 * computeFundingFee(6000, 0.0001)  // → ₹51 (you pay ₹51 per 8h period)
 */
export function computeFundingFee(notionalUsd: number, fundingRate: number): number {
  return usdToInr(notionalUsd * fundingRate);
}

/**
 * Compute the minimum price move needed to break even after fees.
 *
 *   breakEvenMove = totalFeeInr / notionalInr
 *
 * Expressed as a fraction — multiply by 100 for percentage.
 *
 * @param totalFeeInr  Total round-trip fee in INR
 * @param notionalInr  Position notional in INR
 * @returns            Break-even move as a fraction (e.g. 0.0012 = 0.12%)
 *
 * @example
 * // ₹600 fee on ₹500 000 position
 * breakEvenMove(600, 500_000)  // → 0.0012 (0.12%)
 */
export function breakEvenMove(totalFeeInr: number, notionalInr: number): number {
  if (notionalInr <= 0) return 0;
  return totalFeeInr / notionalInr;
}
