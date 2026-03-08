import test from "node:test";
import assert from "node:assert/strict";

import { DeltaCandle } from "../delta/types.js";
import { SwingPoint } from "./structure.js";
import {
  DisplacementDetector,
  SmcContext,
  FVGZone,
  SweepContext,
  MIN_BODY_RATIO,
  ATR_RANGE_MULTIPLIER,
  VOLUME_MULTIPLIER,
  AVG_VOLUME_LOOKBACK,
  CLOSE_POSITION_THRESHOLD,
  SWEEP_LOOKBACK_BARS,
} from "./displacement.detector.js";

const BASE_TS = 1_740_000_000_000;
const RES_MS = 5 * 60 * 1000;

/** Build normal candles followed by a final candidate candle. */
const buildCandles = (
  count: number,
  overrideLast?: Partial<DeltaCandle>
): DeltaCandle[] => {
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

const swingHigh = (price: number, index = 10): SwingPoint => {
  return { type: "HIGH", price, index, timestamp: BASE_TS + index * RES_MS };
}

const swingLow = (price: number, index = 10): SwingPoint => {
  return { type: "LOW", price, index, timestamp: BASE_TS + index * RES_MS };
}

/** Build a valid SmcContext with a recent sweep and matching FVG. */
const validSmcContext = (
  direction: "BULLISH" | "BEARISH",
  currentBarIndex = 100
): SmcContext => {
  const fvgs: FVGZone[] = [
    direction === "BULLISH"
      ? { type: "BULLISH", top: 104, bottom: 102 }
      : { type: "BEARISH", top: 98, bottom: 96 },
  ];
  const sweeps: SweepContext[] = [
    { detectedBarIndex: currentBarIndex - 1 }, // 1 bar ago = within SWEEP_LOOKBACK_BARS
  ];
  return { fvgs, sweeps, currentBarIndex };
}

/**
 * Full institutional displacement candle: all 7 conditions met.
 * Bullish: open=100, low=100, high=107, close=106.5
 *   body=6.5, range=7, bodyRatio=0.929, closePosition=0.929
 *   range(7) > ATR(2)*1.5(3) ✓, volume(30) > avg(10)*1.8(18) ✓
 */
const FULL_BULLISH_CANDLE: Partial<DeltaCandle> = {
  open: 100,
  high: 107,
  low: 100,
  close: 106.5, // closePosition = 6.5/7 = 0.929 > 0.8 ✓
  volume: 30,
};

const FULL_BEARISH_CANDLE: Partial<DeltaCandle> = {
  open: 100,
  high: 100,
  low: 93,
  close: 93.5, // closePosition = 0.5/7 = 0.071 < 0.2 ✓
  volume: 30,
};

// ─── Tests ──────────────────────────────────────────────────────────

test("DisplacementDetector detects bullish institutional displacement", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, FULL_BULLISH_CANDLE);
  const swings = [swingHigh(104)]; // close 106.5 > 104
  const smcCtx = validSmcContext("BULLISH");

  const result = detector.detect(candles, atr, swings, smcCtx);

  assert.notEqual(result, null);
  assert.equal(result!.type, "BULLISH");
  assert.ok(result!.strength >= ATR_RANGE_MULTIPLIER);
  assert.ok(result!.bodyRatio >= MIN_BODY_RATIO);
  assert.ok(result!.closePosition > CLOSE_POSITION_THRESHOLD);
  assert.equal(result!.hadSweep, true);
  assert.equal(result!.hadFVG, true);
});

test("DisplacementDetector detects bearish institutional displacement", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, FULL_BEARISH_CANDLE);
  const swings = [swingLow(95)]; // close 93.5 < 95
  const smcCtx = validSmcContext("BEARISH");

  const result = detector.detect(candles, atr, swings, smcCtx);

  assert.notEqual(result, null);
  assert.equal(result!.type, "BEARISH");
  assert.ok(result!.closePosition < 1 - CLOSE_POSITION_THRESHOLD);
  assert.equal(result!.hadSweep, true);
  assert.equal(result!.hadFVG, true);
});

// ─── Rejection Tests ────────────────────────────────────────────────

test("rejects: no liquidity sweep", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, FULL_BULLISH_CANDLE);
  const swings = [swingHigh(104)];
  // No sweeps in context
  const smcCtx: SmcContext = {
    fvgs: [{ type: "BULLISH", top: 104, bottom: 102 }],
    sweeps: [],
    currentBarIndex: 100,
  };

  assert.equal(detector.detect(candles, atr, swings, smcCtx), null);
});

test("rejects: sweep too old", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, FULL_BULLISH_CANDLE);
  const swings = [swingHigh(104)];
  const smcCtx: SmcContext = {
    fvgs: [{ type: "BULLISH", top: 104, bottom: 102 }],
    sweeps: [{ detectedBarIndex: 90 }], // 10 bars ago > SWEEP_LOOKBACK_BARS
    currentBarIndex: 100,
  };

  assert.equal(detector.detect(candles, atr, swings, smcCtx), null);
});

test("rejects: no SMC context at all", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, FULL_BULLISH_CANDLE);
  const swings = [swingHigh(104)];

  // No smcCtx passed
  assert.equal(detector.detect(candles, atr, swings), null);
});

test("rejects: no structure break", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, FULL_BULLISH_CANDLE);
  const swings = [swingHigh(110)]; // swing high above close = no break
  const smcCtx = validSmcContext("BULLISH");

  assert.equal(detector.detect(candles, atr, swings, smcCtx), null);
});

test("rejects: low body ratio (doji)", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100, high: 107, low: 100,
    close: 100.5, // body = 0.5, ratio = 0.071
    volume: 30,
  });
  const swings = [swingHigh(104)];
  const smcCtx = validSmcContext("BULLISH");

  assert.equal(detector.detect(candles, atr, swings, smcCtx), null);
});

test("rejects: range too small", () => {
  const detector = new DisplacementDetector();
  const atr = 10;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100, high: 103, low: 100,
    close: 102.5,
    volume: 30,
  });
  const swings = [swingHigh(101)];
  const smcCtx = validSmcContext("BULLISH");

  assert.equal(detector.detect(candles, atr, swings, smcCtx), null);
});

test("rejects: insufficient volume", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    ...FULL_BULLISH_CANDLE,
    volume: 12, // 12 < avg(10) * 1.8 = 18
  });
  const swings = [swingHigh(104)];
  const smcCtx = validSmcContext("BULLISH");

  assert.equal(detector.detect(candles, atr, swings, smcCtx), null);
});

test("rejects: close NOT near extreme (closes mid-candle)", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, {
    open: 100, high: 107, low: 100,
    close: 104, // closePosition = 4/7 = 0.57 — NOT > 0.8
    volume: 30,
  });
  const swings = [swingHigh(103)];
  const smcCtx = validSmcContext("BULLISH");

  assert.equal(detector.detect(candles, atr, swings, smcCtx), null);
});

test("rejects: no FVG in displacement direction", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, FULL_BULLISH_CANDLE);
  const swings = [swingHigh(104)];
  // FVG is bearish but displacement is bullish — mismatch
  const smcCtx: SmcContext = {
    fvgs: [{ type: "BEARISH", top: 98, bottom: 96 }],
    sweeps: [{ detectedBarIndex: 99 }],
    currentBarIndex: 100,
  };

  assert.equal(detector.detect(candles, atr, swings, smcCtx), null);
});

test("rejects: empty swings array", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, FULL_BULLISH_CANDLE);
  const smcCtx = validSmcContext("BULLISH");

  assert.equal(detector.detect(candles, atr, [], smcCtx), null);
});

// ─── Pullback Zone Tests ────────────────────────────────────────────

test("pullback zone uses FVG midpoint as entry", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, FULL_BULLISH_CANDLE);
  const swings = [swingHigh(104)];
  // FVG: top=104, bottom=102 → midpoint=103
  const smcCtx = validSmcContext("BULLISH");

  const result = detector.detect(candles, atr, swings, smcCtx);
  assert.notEqual(result, null);
  assert.equal(result!.pullbackZone.entry, 103); // FVG midpoint
  assert.ok(result!.pullbackZone.stop < 100); // below displacement low
});

test("bearish pullback zone uses FVG midpoint", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, FULL_BEARISH_CANDLE);
  const swings = [swingLow(95)];
  // FVG: top=98, bottom=96 → midpoint=97
  const smcCtx = validSmcContext("BEARISH");

  const result = detector.detect(candles, atr, swings, smcCtx);
  assert.notEqual(result, null);
  assert.equal(result!.pullbackZone.entry, 97);
  assert.ok(result!.pullbackZone.stop > 100); // above displacement high
});

// ─── Strength Scoring ───────────────────────────────────────────────

test("strength scoring: range / ATR", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, FULL_BULLISH_CANDLE);
  const swings = [swingHigh(104)];
  const smcCtx = validSmcContext("BULLISH");

  const result = detector.detect(candles, atr, swings, smcCtx);
  assert.notEqual(result, null);
  // range = 107 - 100 = 7, strength = 7/2 = 3.5
  assert.ok(Math.abs(result!.strength - 3.5) < 0.01);
});

// ─── State Persistence ──────────────────────────────────────────────

test("lastEvent persists and reset clears", () => {
  const detector = new DisplacementDetector();
  assert.equal(detector.lastEvent(), null);

  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK + 1, FULL_BULLISH_CANDLE);
  const swings = [swingHigh(104)];
  const smcCtx = validSmcContext("BULLISH");

  detector.detect(candles, atr, swings, smcCtx);
  assert.notEqual(detector.lastEvent(), null);
  assert.equal(detector.lastEvent()!.type, "BULLISH");

  detector.reset();
  assert.equal(detector.lastEvent(), null);
});

test("DisplacementDetector.detectActive correctly evaluates forming candle", () => {
  const detector = new DisplacementDetector();
  const atr = 2;
  const candles = buildCandles(AVG_VOLUME_LOOKBACK); // Current forming candle is NOT in this array
  const lastClosed = candles[candles.length - 1]!;
  
  // Current price 106.5, volume 30
  const currentPrice = 106.5;
  const currentVolume = 30;
  const swings = [swingHigh(104, AVG_VOLUME_LOOKBACK - 1)];
  const smcCtx = validSmcContext("BULLISH", AVG_VOLUME_LOOKBACK);

  const result = detector.detectActive(
    currentPrice,
    currentVolume,
    candles,
    atr,
    swings,
    10, // avgVolume
    smcCtx
  );

  assert.notEqual(result, null);
  assert.equal(result!.type, "BULLISH");
  assert.equal(result!.candle.close, 106.5);
  assert.ok(result!.strength > 3);
});
