/** Historical candle data format (matches DeltaCandle shape) */
export interface Candle {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number; // ms
}

export interface BacktestConfig {
  initialCapital: number;
  /** Fee as a percentage, e.g. 0.05 = 0.05% */
  feePct: number;
  /** Simulated slippage as a percentage, e.g. 0.02 = 0.02% */
  slippagePct: number;
  /** Contract multiplier (default 1) */
  contractValue?: number;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  exit: number;
  qty: number;
  pnl: number;
  /** R-multiple: pnl / initial risk amount */
  rMultiple: number;
  timestamp: number;
  exitReason: "TP" | "SL";
}

export interface BacktestMetrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  netPnL: number;
  maxDrawdown: number;
  /** Annualized Sharpe (approximated from trade PnLs, log-normal) */
  sharpe: number;
  finalCapital: number;
}
