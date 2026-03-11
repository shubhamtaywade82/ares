/**
 * ARES Engine Mode — the three operational modes of the trading engine.
 *
 * Strategy, risk, and indicator logic are **identical** across all modes.
 * Only the market data source and execution adapter differ:
 *
 *   BACKTEST — Historical candle replay, deterministic fills, zero latency.
 *   PAPER    — Live WebSocket feed, simulated fills, realistic fees & slippage.
 *   LIVE     — Live WebSocket feed, real Delta Exchange order placement.
 *
 * This prevents the classic gap where backtests look profitable but live
 * trading fails because the two paths used different code.
 *
 * Set via environment variable: ARES_MODE=backtest | paper | live
 */
export enum EngineMode {
  /** Replay historical candles deterministically. */
  BACKTEST = "BACKTEST",
  /** Live market feed with simulated order execution, fees, and slippage. */
  PAPER = "PAPER",
  /** Live market feed with real Delta Exchange order placement. */
  LIVE = "LIVE",
}

/** Narrow helper — returns true when the mode uses live market data. */
export function isLiveDataMode(mode: EngineMode): boolean {
  return mode === EngineMode.PAPER || mode === EngineMode.LIVE;
}

/** Narrow helper — returns true when orders are simulated (not real). */
export function isSimulatedExecution(mode: EngineMode): boolean {
  return mode === EngineMode.BACKTEST || mode === EngineMode.PAPER;
}
