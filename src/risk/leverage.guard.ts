export function checkLeverage(
  notional: number,
  balance: number,
  maxLeverage: number
): string | null {
  const leverage = notional / balance;

  if (leverage > maxLeverage) {
    return "LEVERAGE_TOO_HIGH";
  }

  return null;
}
