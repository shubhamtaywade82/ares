export function calculatePnl(
  side: "buy" | "sell",
  entryPrice: number,
  exitPrice: number,
  qty: number
): number {
  const direction = side === "buy" ? 1 : -1;
  return direction * (exitPrice - entryPrice) * qty;
}

export function calculateRMultiple(pnl: number, riskUsdt: number): number {
  return riskUsdt !== 0 ? pnl / Math.abs(riskUsdt) : 0;
}
