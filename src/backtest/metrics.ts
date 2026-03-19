import { BacktestTrade, BacktestMetrics } from "./types.js";

/**
 * Pure-function metric computation over a list of completed backtest trades.
 * No side-effects; safe to call multiple times.
 */
export const computeMetrics = (
  trades: BacktestTrade[],
  initialCapital: number,
  finalCapital: number
): BacktestMetrics => {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      netPnL: 0,
      maxDrawdown: 0,
      sharpe: 0,
      finalCapital,
    };
  }

  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;

  for (const t of trades) {
    if (t.pnl > 0) {
      wins++;
      grossProfit += t.pnl;
    } else {
      grossLoss += Math.abs(t.pnl);
    }
  }

  const netPnL = grossProfit - grossLoss;
  const winRate = wins / trades.length;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Max drawdown from equity curve
  let peak = initialCapital;
  let equity = initialCapital;
  let maxDD = 0;
  for (const t of trades) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  // Approximate Sharpe: mean(returns) / stddev(returns) * sqrt(252)
  const returns = trades.map((t) => t.pnl);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  const stddev = Math.sqrt(variance);
  const sharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(252) : 0;

  return {
    totalTrades: trades.length,
    winRate,
    profitFactor,
    netPnL,
    maxDrawdown: maxDD,
    sharpe,
    finalCapital,
  };
};
