/**
 * Delta Exchange India fixed FX conversion.
 *
 * Delta India wallets are denominated in INR with a **fixed** conversion rate
 * of 1 USD = INR 85.  No live forex feed is needed.
 *
 * All trading math (prices, PnL, notional) runs in USD.
 * Wallet balances, margin, and reporting convert back to INR via this module.
 */

/** Fixed USD/INR rate as stated by Delta Exchange India. */
export const USD_INR_RATE = 85 as const;

/** Convert an INR amount to its USD equivalent. */
export function inrToUsd(inr: number): number {
  return inr / USD_INR_RATE;
}

/** Convert a USD amount to its INR equivalent. */
export function usdToInr(usd: number): number {
  return usd * USD_INR_RATE;
}

/**
 * INR → USD multiplier for use in formulas that expect a scalar.
 *
 * Example:  `riskAmountUSD = riskAmountINR * INR_TO_USD`
 */
export const INR_TO_USD: number = 1 / USD_INR_RATE;
