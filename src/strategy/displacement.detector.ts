import { DeltaCandle } from "../delta/types.js";
import { SwingPoint } from "./structure.js";

// ─── Tuning Constants ───────────────────────────────────────────────
/** Minimum body-to-range ratio (0.7 = body ≥ 70% of candle range). */
export const MIN_BODY_RATIO = 0.7;

/** Candle range must exceed ATR × this multiplier. */
export const ATR_RANGE_MULTIPLIER = 1.5;

/** Volume must exceed 20-bar average × this multiplier. */
export const VOLUME_MULTIPLIER = 1.8;

/** Number of candles for average volume calculation. */
export const AVG_VOLUME_LOOKBACK = 20;

/** Minimum displacement strength (range / ATR) to consider tradeable. */
export const MIN_STRENGTH = 1.5;

/** Pullback entry retracement ratio (0.5 = 50% of displacement range). */
export const PULLBACK_RETRACEMENT = 0.5;

// ─── Types ──────────────────────────────────────────────────────────
export type DisplacementDirection = "BULLISH" | "BEARISH";

export interface PullbackZone {
  /** Optimal entry price (50% retracement of displacement candle). */
  entry: number;
  /** Stop-loss price (just beyond the displacement candle extreme). */
  stop: number;
}

export interface DisplacementEvent {
  type: DisplacementDirection;
  /** Strength score: range / ATR. Values ≥2 are strong, ≥3 institutional. */
  strength: number;
  /** Body-to-range ratio (0–1). */
  bodyRatio: number;
  /** The displacement candle itself. */
  candle: DeltaCandle;
  /** Calculated pullback entry + stop zone. */
  pullbackZone: PullbackZone;
  /** Timestamp of detection. */
  timestamp: number;
}

// ─── Detector ───────────────────────────────────────────────────────
export class DisplacementDetector {
  private event: DisplacementEvent | null = null;

  /**
   * Evaluate the latest candle for displacement characteristics.
   *
   * @param candles  Closed candle history (needs ≥ AVG_VOLUME_LOOKBACK + 1).
   * @param atr     Current ATR(14) value.
   * @param swings  Recent swing points from StructureAnalyzer.
   * @returns The detected displacement event, or `null`.
   */
  detect(
    candles: readonly DeltaCandle[],
    atr: number,
    swings: readonly SwingPoint[],
  ): DisplacementEvent | null {
    if (candles.length < AVG_VOLUME_LOOKBACK + 1 || atr <= 0) return null;

    const candle = candles[candles.length - 1]!;
    const range = candle.high - candle.low;
    if (range <= 0) return null;

    const body = Math.abs(candle.close - candle.open);
    const bodyRatio = body / range;

    // ── Condition 1: Body dominance ──
    if (bodyRatio < MIN_BODY_RATIO) return null;

    // ── Condition 2: Abnormal range ──
    if (range < atr * ATR_RANGE_MULTIPLIER) return null;

    // ── Condition 3: Volume expansion ──
    const avgVolume = this.averageVolume(candles);
    if (avgVolume <= 0 || candle.volume < avgVolume * VOLUME_MULTIPLIER) return null;

    // ── Condition 4: Structure break ──
    const direction = candle.close > candle.open ? "BULLISH" : "BEARISH";
    if (!this.breaksStructure(candle, direction, swings)) return null;

    // ── All conditions met ──
    const strength = range / atr;
    const pullbackZone = this.computePullbackZone(candle, direction);

    this.event = {
      type: direction,
      strength,
      bodyRatio,
      candle,
      pullbackZone,
      timestamp: candle.timestamp,
    };

    return this.event;
  }

  /** Returns the most recently detected displacement event. */
  lastEvent(): DisplacementEvent | null {
    return this.event;
  }

  /** Reset detector state. */
  reset(): void {
    this.event = null;
  }

  // ─── Internals ──────────────────────────────────────────────────

  private averageVolume(candles: readonly DeltaCandle[]): number {
    // Use the AVG_VOLUME_LOOKBACK candles before the last one
    const start = candles.length - 1 - AVG_VOLUME_LOOKBACK;
    const end = candles.length - 1;
    if (start < 0) return 0;

    let sum = 0;
    for (let i = start; i < end; i++) {
      sum += candles[i]!.volume;
    }
    return sum / AVG_VOLUME_LOOKBACK;
  }

  private breaksStructure(
    candle: DeltaCandle,
    direction: DisplacementDirection,
    swings: readonly SwingPoint[],
  ): boolean {
    if (swings.length === 0) return false;

    if (direction === "BULLISH") {
      // Must close above the most recent swing high
      const lastHigh = this.lastSwingOfType(swings, "HIGH");
      return lastHigh !== null && candle.close > lastHigh.price;
    } else {
      // Must close below the most recent swing low
      const lastLow = this.lastSwingOfType(swings, "LOW");
      return lastLow !== null && candle.close < lastLow.price;
    }
  }

  private lastSwingOfType(
    swings: readonly SwingPoint[],
    type: "HIGH" | "LOW",
  ): SwingPoint | null {
    for (let i = swings.length - 1; i >= 0; i--) {
      if (swings[i]!.type === type) return swings[i]!;
    }
    return null;
  }

  private computePullbackZone(
    candle: DeltaCandle,
    direction: DisplacementDirection,
  ): PullbackZone {
    const range = candle.high - candle.low;
    const retracement = range * PULLBACK_RETRACEMENT;

    if (direction === "BULLISH") {
      // Pullback = dip back into the lower half of the displacement candle
      return {
        entry: candle.high - retracement,
        stop: candle.low - range * 0.05, // small buffer below candle low
      };
    } else {
      // Pullback = rally back into the upper half of the displacement candle
      return {
        entry: candle.low + retracement,
        stop: candle.high + range * 0.05, // small buffer above candle high
      };
    }
  }
}
