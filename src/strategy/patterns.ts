import { DeltaCandle } from "../delta/types.js";

export type PatternType = "ENGULFING_BULL" | "ENGULFING_BEAR" | "PIN_BAR_BULL" | "PIN_BAR_BEAR" | "INSIDE_BAR";

export interface Pattern {
  type: PatternType;
  timestamp: number;
  score: number;
}

export function detectPattern(candles: readonly DeltaCandle[]): Pattern | null {
  if (candles.length < 2) return null;

  const last = candles.at(-1);
  const prev = candles.at(-2);
  if (!last || !prev) return null;

  const bodySize = Math.abs(last.close - last.open);
  const wickSizeTop = last.high - Math.max(last.open, last.close);
  const wickSizeBottom = Math.min(last.open, last.close) - last.low;

  // 1. Engulfing
  if (last.close > last.open && prev.close < prev.open && last.close > prev.open && last.open < prev.close) {
    return { type: "ENGULFING_BULL", timestamp: last.timestamp, score: 3 };
  }
  if (last.close < last.open && prev.close > prev.open && last.close < prev.open && last.open > prev.close) {
    return { type: "ENGULFING_BEAR", timestamp: last.timestamp, score: 3 };
  }

  // 2. Pin Bar (Hammer / Shooting Star)
  if (wickSizeBottom > bodySize * 2 && wickSizeTop < bodySize) {
    return { type: "PIN_BAR_BULL", timestamp: last.timestamp, score: 2 };
  }
  if (wickSizeTop > bodySize * 2 && wickSizeBottom < bodySize) {
    return { type: "PIN_BAR_BEAR", timestamp: last.timestamp, score: 2 };
  }

  // 3. Inside Bar
  if (last.high <= prev.high && last.low >= prev.low) {
    return { type: "INSIDE_BAR", timestamp: last.timestamp, score: 1 };
  }

  return null;
}
