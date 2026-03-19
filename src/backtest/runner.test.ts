import { runBacktest } from "./runner.js";
import type { Candle } from "./types.js";
import assert from "node:assert/strict";
import { test } from "node:test";

test("runBacktest returns valid metrics with synthetic candles", async () => {
  // 30 candles with a rising trend: each candle's close is above open
  const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
    symbol: "BTCUSD",
    open: 40000 + i * 100,
    high: 40000 + i * 100 + 200,
    low: 40000 + i * 100 - 50,
    close: 40000 + i * 100 + 150,
    volume: 5 + i,
    timestamp: Date.now() + i * 60_000,
  }));

  const result = await runBacktest(candles, {
    initialCapital: 10_000,
    feePct: 0.05,
    slippagePct: 0.02,
  });

  assert.ok(result.metrics.totalTrades >= 0, "totalTrades should be >= 0");
  assert.ok(result.metrics.winRate >= 0 && result.metrics.winRate <= 1, "winRate should be [0, 1]");
  assert.ok(Number.isFinite(result.metrics.netPnL), "netPnL should be finite");
  assert.ok(Number.isFinite(result.metrics.maxDrawdown), "maxDrawdown should be finite");
  assert.ok(Number.isFinite(result.metrics.finalCapital), "finalCapital should be finite");
  assert.ok(Array.isArray(result.trades), "trades should be an array");

  console.log(
    `Backtest: trades=${result.metrics.totalTrades} winRate=${(result.metrics.winRate * 100).toFixed(1)}% netPnL=${result.metrics.netPnL.toFixed(2)}`
  );
});
