import test from "node:test";
import assert from "node:assert/strict";

import { DeltaCandle } from "../delta/types.js";
import { SwingPoint } from "./structure.js";
import {
  DisplacementDetector,
  MIN_BODY_RATIO,
  ATR_RANGE_MULTIPLIER,
  VOLUME_MULTIPLIER,
  AVG_VOLUME_LOOKBACK,
} from "./displacement.detector.js";

const BASE_TS = 1_740_000_000_000;
const RES_MS = 5 * 60 * 1000;

/** Build a set of normal candles followed by a final candidate candle. */
function buildCandles(
  count: number,
  overrideLast?: Partial<DeltaCandle>
): DeltaCandle[] {
  const candles: DeltaCandle[] = [];
  for (let i = 0; i < count; i++) {
    candles.push({
      timestamp: BASE_TS + i * RES_MS,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
    });
  }
  if (overrideLast && candles.length > 0) {
    Object.assign(candles[candles.length - 1]!, overrideLast);
  }
  return candles;
}

function swingHigh(price: number, index = 10): SwingPoint {
  return { type: "HIGH", price, index, timestamp: BASE_TS + index * RES_MS };
}

function swingLow(price: number, index = 10): SwingPoint {
  return { type: "LOW", price, index, timestamp: BASE_TS + index * RES_MS };
}

// ─── Tests ──────────────────────────────────────────────────────────

test("DisplacementDetector detects bullish displacement", () => {
  const detector = new DisplacementDetector();
  const atr = 2; // range of normal candles is 2
  // Displacement candle: big bullish body, breaks swing high, volume spike
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100,
    high: 107,  // range = 7, > ATR*1.5 = 3
    low: 100,
    close: 106, // body = 6, ratio = 6/7 = 0.857 > 0.7
    volume: 30, // 30 > avg(10) * 1.8 = 18
  });
  const swings = [swingHigh(104)]; // close 106 > 104 = structure break

  const result = detector.detect(candles, atr, swings);

  assert.notEqual(result, null);
  assert.equal(result!.type, "BULLISH");
  assert.ok(result!.strength >= ATR_RANGE_MULTIPLIER);
  assert.ok(result!.bodyRatio >= MIN_BODY_RATIO);
  assert.ok(result!.pullbackZone.entry > result!.pullbackZone.stop);
});

test("DisplacementDetector detects bearish displacement", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100,
    high: 100,
    low: 93,    // range = 7
    close: 94,  // body = 6, ratio = 6/7 = 0.857
    volume: 30,
  });
  const swings = [swingLow(95)]; // close 94 < 95 = structure break

  const result = detector.detect(candles, atr, swings);

  assert.notEqual(result, null);
  assert.equal(result!.type, "BEARISH");
  assert.ok(result!.strength >= ATR_RANGE_MULTIPLIER);
  assert.ok(result!.pullbackZone.entry < result!.pullbackZone.stop);
});

test("DisplacementDetector rejects low body ratio (doji candle)", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  // Big range but tiny body (doji) — body ratio fails
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100,
    high: 107,
    low: 100,
    close: 100.5, // body = 0.5, ratio = 0.5/7 = 0.071 < 0.7
    volume: 30,
  });
  const swings = [swingHigh(104)];

  const result = detector.detect(candles, atr, swings);
  assert.equal(result, null);
});

test("DisplacementDetector rejects when no structure break", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100,
    high: 107,
    low: 100,
    close: 106,
    volume: 30,
  });
  // Swing high is above close — no break
  const swings = [swingHigh(110)];

  const result = detector.detect(candles, atr, swings);
  assert.equal(result, null);
});

test("DisplacementDetector rejects when volume is insufficient", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100,
    high: 107,
    low: 100,
    close: 106,
    volume: 12, // 12 < avg(10) * 1.8 = 18
  });
  const swings = [swingHigh(104)];

  const result = detector.detect(candles, atr, swings);
  assert.equal(result, null);
});

test("DisplacementDetector rejects when range is too small", () => {
  const detector = new DisplacementDetector();
  const atr = 10; // high ATR
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100,
    high: 103,  // range = 3, < ATR*1.5 = 15
    low: 100,
    close: 102.5,
    volume: 30,
  });
  const swings = [swingHigh(101)];

  const result = detector.detect(candles, atr, swings);
  assert.equal(result, null);
});

test("DisplacementDetector pullback zone: bullish entry at 50% retracement", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100,
    high: 108,  // range = 8
    low: 100,
    close: 107,
    volume: 30,
  });
  const swings = [swingHigh(104)];

  const result = detector.detect(candles, atr, swings);
  assert.notEqual(result, null);

  // Bullish: entry = high - range*0.5 = 108 - 4 = 104
  // stop = low - range*0.05 = 100 - 0.4 = 99.6
  assert.equal(result!.pullbackZone.entry, 104);
  assert.ok(Math.abs(result!.pullbackZone.stop - 99.6) < 0.01);
});

test("DisplacementDetector strength scoring: range / ATR", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100,
    high: 107,  // range = 7
    low: 100,
    close: 106,
    volume: 30,
  });
  const swings = [swingHigh(104)];

  const result = detector.detect(candles, atr, swings);
  assert.notEqual(result, null);
  // strength = 7 / 2 = 3.5
  assert.ok(Math.abs(result!.strength - 3.5) < 0.01);
});

test("DisplacementDetector lastEvent persists after detection", () => {
  const detector = new DisplacementDetector();
  assert.equal(detector.lastEvent(), null);

  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100,
    high: 107,
    low: 100,
    close: 106,
    volume: 30,
  });
  const swings = [swingHigh(104)];

  detector.detect(candles, atr, swings);
  const event = detector.lastEvent();
  assert.notEqual(event, null);
  assert.equal(event!.type, "BULLISH");

  // Reset clears it
  detector.reset();
  assert.equal(detector.lastEvent(), null);
});

test("DisplacementDetector rejects with no swings", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100,
    high: 107,
    low: 100,
    close: 106,
    volume: 30,
  });

  const result = detector.detect(candles, atr, []);
  assert.equal(result, null);
});
