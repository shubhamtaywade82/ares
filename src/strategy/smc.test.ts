import test from "node:test";
import assert from "node:assert/strict";

import { DeltaCandle } from "../delta/types.js";
import { SmcAnalyzer } from "./smc.js";
import { SwingPoint } from "./structure.js";

const RESOLUTION_MS = 15 * 60 * 1000;

function buildCandlesWithBearTrap(baseTs: number): DeltaCandle[] {
  const candles: DeltaCandle[] = [];
  for (let i = 0; i < 21; i++) {
    candles.push({
      timestamp: baseTs + i * RESOLUTION_MS,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
    });
  }

  const last = candles[candles.length - 1];
  if (last) {
    last.high = 102;
    last.low = 95;
    last.close = 100.5;
    last.volume = 25;
  }

  return candles;
}

function swingsForBearTrap(lastCandle: DeltaCandle): SwingPoint[] {
  return [
    {
      type: "LOW",
      price: 98,
      index: 10,
      timestamp: lastCandle.timestamp - RESOLUTION_MS,
    },
  ];
}

test("SmcAnalyzer uses deterministic timestamp-derived bar index across instances", () => {
  const a = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS }) as any;
  const b = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS }) as any;

  const ts = 1_740_000_000_000;
  assert.equal(a.barIndex(ts), b.barIndex(ts));
});

test("SmcAnalyzer expires sweeps after 8 bars", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS }) as any;

  analyzer.sweeps = [
    {
      type: "BEAR_TRAP",
      reference: 98,
      high: 102,
      low: 95,
      close: 100,
      volume: 20,
      avgVolume20: 10,
      timestamp: 1_740_000_000_000,
      detectedBarIndex: 100,
    },
  ];
  analyzer.lastProcessedTimestamp = (100 + 9) * RESOLUTION_MS;
  analyzer.expireSweeps();

  assert.equal(analyzer.sweeps.length, 0);
});

test("SmcAnalyzer live idempotency blocks duplicate processing of same closed candle", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });
  const candles = buildCandlesWithBearTrap(1_740_000_000_000);
  const last = candles[candles.length - 1];
  assert.ok(last);
  const swings = swingsForBearTrap(last);

  analyzer.update(candles, [], swings, true);
  analyzer.update(candles, [], swings, true);

  assert.equal(analyzer.lastSweeps.length, 1);
});

test("SmcAnalyzer seed path bypasses idempotency guard when isLive=false", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });

  const newer = buildCandlesWithBearTrap(1_740_000_000_000);
  const older = buildCandlesWithBearTrap(1_740_000_000_000 - 3 * RESOLUTION_MS);

  const newerLast = newer[newer.length - 1];
  const olderLast = older[older.length - 1];
  assert.ok(newerLast && olderLast);

  analyzer.update(newer, [], swingsForBearTrap(newerLast), true);
  analyzer.update(older, [], swingsForBearTrap(olderLast), true);
  assert.equal(analyzer.lastSweeps.length, 1);

  analyzer.update(older, [], swingsForBearTrap(olderLast), false);
  assert.equal(analyzer.lastSweeps.length, 2);
});
