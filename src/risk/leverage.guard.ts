import { RISK_CONFIG } from "../config/risk.js";

export function checkLeverage(
  notional: number,
  balance: number
): string | null {
  const leverage = notional / balance;

  if (leverage > RISK_CONFIG.maxLeverage) {
    return "LEVERAGE_TOO_HIGH";
  }

  return null;
}
