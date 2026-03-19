import { Candle, BacktestConfig, BacktestMetrics, BacktestTrade } from "./types.js";
import { BacktestSimulator } from "./simulator.js";
import { replayCandles } from "./candle.feed.js";
import { computeMetrics } from "./metrics.js";
import { disableEventPersistence, enableEventPersistence } from "../market/event.bus.js";

export interface BacktestResult {
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
}

/**
 * Run a complete backtest:
 *   1. Disables event persistence (so backtest events don't write to live log)
 *   2. Initializes a simulated executor listening on the event bus
 *   3. Replays candles as TICK events
 *   4. Computes and returns metrics
 *
 * NOTE: Any strategy/risk/AI listeners that have been initialized on the event bus
 * will receive and process these events exactly as they would in production.
 * Initialize your strategy before calling this function.
 */
export const runBacktest = async (
  candles: Candle[],
  config: BacktestConfig
): Promise<BacktestResult> => {
  console.log(
    `[ARES.BACKTEST] Starting — ${candles.length} candles, capital=${config.initialCapital}`
  );

  disableEventPersistence();

  const simulator = new BacktestSimulator(config);
  simulator.init();

  try {
    await replayCandles(candles);
  } finally {
    enableEventPersistence();
  }

  const trades = simulator.completedTrades;
  const metrics = computeMetrics(trades, config.initialCapital, simulator.finalCapital);

  console.log(
    `[ARES.BACKTEST] Done — trades=${metrics.totalTrades} winRate=${(metrics.winRate * 100).toFixed(1)}% netPnL=${metrics.netPnL.toFixed(2)}`
  );

  return { metrics, trades };
};
