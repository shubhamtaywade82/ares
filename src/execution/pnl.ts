export const calculatePnl = (
  side: "buy" | "sell",
  entryPrice: number,
  exitPrice: number,
  qty: number,
  contractValue: number = 1
): number => {
  const direction = side === "buy" ? 1 : -1;
  return direction * (exitPrice - entryPrice) * qty * contractValue;
}

export const calculateRMultiple = (pnl: number, riskUsdt: number): number => {
  return riskUsdt !== 0 ? pnl / Math.abs(riskUsdt) : 0;
}
