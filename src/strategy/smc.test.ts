import test from "node:test";
import assert from "node:assert/strict";

import { DeltaCandle } from "../delta/types.js";
import { SmcAnalyzer } from "./smc.js";
import { StructureAnalyzer, SwingPoint } from "./structure.js";

const RESOLUTION_MS = 15 * 60 * 1000;

const buildCandlesWithBearTrap = (baseTs: number): DeltaCandle[] => {
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

const swingsForBearTrap = (lastCandle: DeltaCandle): SwingPoint[] => {
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

test("StructureAnalyzer premiumDiscount returns null with no swings", () => {
  const structure = new StructureAnalyzer();
  const result = structure.premiumDiscount(100);
  assert.equal(result, null);
});

test("StructureAnalyzer premiumDiscount identifies DISCOUNT zone", () => {
  const structure = new StructureAnalyzer();
  (structure as unknown as { swings: SwingPoint[] }).swings = [
    { type: "LOW", price: 90, index: 1, timestamp: 1000 },
    { type: "HIGH", price: 110, index: 5, timestamp: 5000 },
  ];
  const result = structure.premiumDiscount(95);
  assert.ok(result);
  assert.equal(result!.zone, "DISCOUNT");
  assert.equal(result!.percentile, 25);
  assert.equal(result!.equilibrium, 100);
});

test("StructureAnalyzer premiumDiscount identifies PREMIUM zone", () => {
  const structure = new StructureAnalyzer();
  (structure as unknown as { swings: SwingPoint[] }).swings = [
    { type: "LOW", price: 90, index: 1, timestamp: 1000 },
    { type: "HIGH", price: 110, index: 5, timestamp: 5000 },
  ];
  const result = structure.premiumDiscount(106);
  assert.ok(result);
  assert.equal(result!.zone, "PREMIUM");
  assert.equal(result!.percentile, 80);
});

test("StructureAnalyzer premiumDiscount identifies EQUILIBRIUM zone", () => {
  const structure = new StructureAnalyzer();
  (structure as unknown as { swings: SwingPoint[] }).swings = [
    { type: "LOW", price: 90, index: 1, timestamp: 1000 },
    { type: "HIGH", price: 110, index: 5, timestamp: 5000 },
  ];
  const result = structure.premiumDiscount(100.3);
  assert.ok(result);
  assert.equal(result!.zone, "EQUILIBRIUM");
});

test("StructureAnalyzer premiumDiscount clamps percentile 0-100", () => {
  const structure = new StructureAnalyzer();
  (structure as unknown as { swings: SwingPoint[] }).swings = [
    { type: "LOW", price: 90, index: 1, timestamp: 1000 },
    { type: "HIGH", price: 110, index: 5, timestamp: 5000 },
  ];
  const below = structure.premiumDiscount(85);
  assert.ok(below);
  assert.equal(below!.percentile, 0);

  const above = structure.premiumDiscount(115);
  assert.ok(above);
  assert.equal(above!.percentile, 100);
});

test("StructureAnalyzer premiumDiscount returns null when swingHigh <= swingLow", () => {
  const structure = new StructureAnalyzer();
  (structure as unknown as { swings: SwingPoint[] }).swings = [
    { type: "HIGH", price: 90, index: 1, timestamp: 1000 },
    { type: "LOW", price: 100, index: 5, timestamp: 5000 },
  ];
  const result = structure.premiumDiscount(95);
  assert.equal(result, null);
});

test("SmcAnalyzer detects bearish breaker from failed bullish OB", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });
  const baseTs = 1_740_000_000_000;
  const lastTs = baseTs + 5 * RESOLUTION_MS;
  const barIndexCurrent = Math.floor(lastTs / RESOLUTION_MS);
  const obBarIndex = barIndexCurrent - 1;
  (analyzer as unknown as { obs: import("./smc.js").OrderBlock[] }).obs = [
    {
      type: "BULLISH",
      top: 105,
      bottom: 100,
      timestamp: baseTs,
      barIndex: obBarIndex,
      volume: 20,
      isMitigated: true,
    },
  ];

  const candles: DeltaCandle[] = [];
  for (let i = 0; i < 5; i++) {
    candles.push({
      timestamp: baseTs + (i + 1) * RESOLUTION_MS,
      open: 101,
      high: 99,
      low: 98,
      close: 99,
      volume: 15,
    });
  }

  analyzer.update(candles, [], [], false);

  const breakers = analyzer.lastBreakers;
  assert.equal(breakers.length, 1);
  assert.equal(breakers[0]!.type, "BEARISH");
  assert.equal(breakers[0]!.originalObType, "BULLISH");
  assert.equal(breakers[0]!.top, 105);
  assert.equal(breakers[0]!.bottom, 100);
});

test("SmcAnalyzer detects bullish breaker from failed bearish OB", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });
  const baseTs = 1_740_000_000_000;
  const lastTs = baseTs + 5 * RESOLUTION_MS;
  const barIndexCurrent = Math.floor(lastTs / RESOLUTION_MS);
  const obBarIndex = barIndexCurrent - 1;
  (analyzer as unknown as { obs: import("./smc.js").OrderBlock[] }).obs = [
    {
      type: "BEARISH",
      top: 105,
      bottom: 100,
      timestamp: baseTs,
      barIndex: obBarIndex,
      volume: 20,
      isMitigated: true,
    },
  ];

  const candles: DeltaCandle[] = [];
  for (let i = 0; i < 5; i++) {
    candles.push({
      timestamp: baseTs + (i + 1) * RESOLUTION_MS,
      open: 106,
      high: 107,
      low: 106,
      close: 106,
      volume: 15,
    });
  }

  analyzer.update(candles, [], [], false);

  const breakers = analyzer.lastBreakers;
  assert.equal(breakers.length, 1);
  assert.equal(breakers[0]!.type, "BULLISH");
  assert.equal(breakers[0]!.originalObType, "BEARISH");
});

test("SmcAnalyzer does not create breaker on wick-only mitigation", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });
  (analyzer as unknown as { obs: import("./smc.js").OrderBlock[] }).obs = [
    {
      type: "BULLISH",
      top: 105,
      bottom: 100,
      timestamp: 1_740_000_000_000,
      barIndex: 100,
      volume: 20,
      isMitigated: false,
    },
  ];

  const candles: DeltaCandle[] = [];
  for (let i = 0; i < 5; i++) {
    candles.push({
      timestamp: 1_740_000_000_000 + (i + 1) * RESOLUTION_MS,
      open: 102,
      high: 103,
      low: 98,
      close: 101,
      volume: 15,
    });
  }

  analyzer.update(candles, [], [], false);

  const breakers = analyzer.lastBreakers;
  assert.equal(breakers.length, 0);
});

test("SmcAnalyzer nearestBreaker finds closest unmitigated breaker", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });
  (analyzer as unknown as { breakers: import("./smc.js").BreakerBlock[] }).breakers = [
    {
      type: "BEARISH",
      top: 105,
      bottom: 100,
      originalObType: "BULLISH",
      timestamp: 1_740_000_000_000,
      barIndex: 100,
      isMitigated: false,
    },
    {
      type: "BEARISH",
      top: 112,
      bottom: 110,
      originalObType: "BULLISH",
      timestamp: 1_740_000_000_000 + RESOLUTION_MS,
      barIndex: 101,
      isMitigated: false,
    },
  ];
  (analyzer as unknown as { lastProcessedTimestamp: number }).lastProcessedTimestamp =
    102 * RESOLUTION_MS;

  const nearest = analyzer.nearestBreaker(103, "BEARISH");
  assert.ok(nearest);
  assert.equal(nearest!.top, 105);
  assert.equal(nearest!.bottom, 100);
});

test("SmcAnalyzer detects bear inducement (minor higher-low in downtrend swept)", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });
  const baseTs = 1_740_000_000_000;

  const majorSwings: SwingPoint[] = [
    { type: "HIGH", price: 110, index: 5, timestamp: baseTs + 5 * RESOLUTION_MS },
    { type: "LOW", price: 95, index: 10, timestamp: baseTs + 10 * RESOLUTION_MS },
  ];

  const minorSwings: SwingPoint[] = [
    ...majorSwings,
    { type: "LOW", price: 97, index: 16, timestamp: baseTs + 16 * RESOLUTION_MS },
  ];

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
  const last = candles[candles.length - 1]!;
  last.low = 96;
  last.close = 98;

  analyzer.update(candles, [], minorSwings, false);

  const inducements = analyzer.lastInducements;
  assert.ok(inducements.length >= 1);
  const ind = inducements.find((i) => i.type === "BEAR_INDUCEMENT");
  assert.ok(ind);
  assert.equal(ind!.level, 97);
  assert.equal(ind!.isSwept, true);
});

test("SmcAnalyzer detects bull inducement (minor lower-high in uptrend swept)", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });
  const baseTs = 1_740_000_000_000;

  const swings: SwingPoint[] = [
    { type: "LOW", price: 90, index: 5, timestamp: baseTs + 5 * RESOLUTION_MS },
    { type: "HIGH", price: 110, index: 10, timestamp: baseTs + 10 * RESOLUTION_MS },
    { type: "HIGH", price: 108, index: 16, timestamp: baseTs + 16 * RESOLUTION_MS },
  ];

  const candles: DeltaCandle[] = [];
  for (let i = 0; i < 21; i++) {
    candles.push({
      timestamp: baseTs + i * RESOLUTION_MS,
      open: 106,
      high: 107,
      low: 105,
      close: 106,
      volume: 10,
    });
  }
  const last = candles[candles.length - 1]!;
  last.high = 109;
  last.close = 107;

  analyzer.update(candles, [], swings, false);

  const inducements = analyzer.lastInducements;
  const ind = inducements.find((i) => i.type === "BULL_INDUCEMENT");
  assert.ok(ind);
  assert.equal(ind!.level, 108);
  assert.equal(ind!.isSwept, true);
});
