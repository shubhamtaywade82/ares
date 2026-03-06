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

/**
 * Bullish close must be in the top 20% of the range (close_position > 0.8).
 * Bearish close must be in the bottom 20% (close_position < 0.2).
 */
export const CLOSE_POSITION_THRESHOLD = 0.8;

/** Max bars to look back for a recent liquidity sweep. */
export const SWEEP_LOOKBACK_BARS = 3;

// ─── Types ──────────────────────────────────────────────────────────
export type DisplacementDirection = "BULLISH" | "BEARISH";

/** Represents a Fair Value Gap zone relevant to displacement. */
export interface FVGZone {
  type: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
}

/** Represents a recent liquidity sweep. */
export interface SweepContext {
  /** Bar index when the sweep was detected. */
  detectedBarIndex: number;
}

/** SMC context passed in from SmcAnalyzer at the point of detection. */
export interface SmcContext {
  /** Active (unfilled) FVGs. */
  fvgs: readonly FVGZone[];
  /** Recent liquidity sweeps with bar indices. */
  sweeps: readonly SweepContext[];
  /** Current bar index for age calculations. */
  currentBarIndex: number;
}

export interface PullbackZone {
  /** Optimal entry price (FVG midpoint if available, else 50% retracement). */
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
  /** Close position within range (0=low, 1=high). */
  closePosition: number;
  /** Whether a liquidity sweep preceded this displacement. */
  hadSweep: boolean;
  /** Whether the displacement created an FVG. */
  hadFVG: boolean;
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
   * Evaluate the latest candle for institutional displacement.
   *
   * Seven conditions must be met:
   * 1. Liquidity sweep within the last SWEEP_LOOKBACK_BARS
   * 2. Structure break (close beyond swing high/low)
   * 3. Body ratio > 0.7 (strong directional body)
   * 4. Range > ATR × 1.5 (abnormal volatility)
   * 5. Volume > avg20 × 1.8 (institutional volume)
   * 6. Close near extreme (> 0.8 bullish, < 0.2 bearish)
   * 7. FVG created (imbalance confirmation)
   *
   * @param candles  Closed candle history (needs ≥ AVG_VOLUME_LOOKBACK + 1).
   * @param atr      Current ATR(14) value.
   * @param swings   Recent swing points from StructureAnalyzer.
   * @param smcCtx   SMC context: recent FVGs and sweeps from SmcAnalyzer.
   * @returns The detected displacement event, or `null`.
   */
  detect(
    candles: readonly DeltaCandle[],
    atr: number,
    swings: readonly SwingPoint[],
    smcCtx?: SmcContext,
  ): DisplacementEvent | null {
    if (candles.length < AVG_VOLUME_LOOKBACK + 1 || atr <= 0) return null;

    const candle = candles[candles.length - 1]!;
    const range = candle.high - candle.low;
    if (range <= 0) return null;

    const body = Math.abs(candle.close - candle.open);
    const bodyRatio = body / range;
    const direction: DisplacementDirection = candle.close > candle.open ? "BULLISH" : "BEARISH";

    // Normalized close position: 0 = at low, 1 = at high
    const closePosition = (candle.close - candle.low) / range;

    // ── Condition 1: Liquidity sweep precondition ──
    const hadSweep = this.hadRecentSweep(smcCtx);
    if (!hadSweep) return null;

    // ── Condition 2: Structure break ──
    if (!this.breaksStructure(candle, direction, swings)) return null;

    // ── Condition 3: Body dominance ──
    if (bodyRatio < MIN_BODY_RATIO) return null;

    // ── Condition 4: Abnormal range ──
    if (range < atr * ATR_RANGE_MULTIPLIER) return null;

    // ── Condition 5: Volume expansion ──
    const avgVolume = this.averageVolume(candles);
    if (avgVolume <= 0 || candle.volume < avgVolume * VOLUME_MULTIPLIER) return null;

    // ── Condition 6: Close near extreme ──
    const closeNearExtreme =
      direction === "BULLISH"
        ? closePosition > CLOSE_POSITION_THRESHOLD
        : closePosition < (1 - CLOSE_POSITION_THRESHOLD);
    if (!closeNearExtreme) return null;

    // ── Condition 7: FVG created (imbalance exists in the direction) ──
    const hadFVG = this.hasFVGInDirection(direction, smcCtx);
    if (!hadFVG) return null;

    // ── All 7 conditions met — institutional displacement ──
    const strength = range / atr;
    const pullbackZone = this.computePullbackZone(candle, direction, smcCtx);

    this.event = {
      type: direction,
      strength,
      bodyRatio,
      closePosition,
      hadSweep,
      hadFVG,
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

  private hadRecentSweep(smcCtx?: SmcContext): boolean {
    if (!smcCtx || smcCtx.sweeps.length === 0) return false;

    return smcCtx.sweeps.some(
      (s) => smcCtx.currentBarIndex - s.detectedBarIndex <= SWEEP_LOOKBACK_BARS
    );
  }

  private hasFVGInDirection(direction: DisplacementDirection, smcCtx?: SmcContext): boolean {
    if (!smcCtx || smcCtx.fvgs.length === 0) return false;
    return smcCtx.fvgs.some((f) => f.type === direction);
  }

  private averageVolume(candles: readonly DeltaCandle[]): number {
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
      const lastHigh = this.lastSwingOfType(swings, "HIGH");
      return lastHigh !== null && candle.close > lastHigh.price;
    } else {
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

  /**
   * Compute pullback zone. Uses FVG midpoint if available (institutional
   * imbalance); falls back to 50% candle retracement otherwise.
   */
  private computePullbackZone(
    candle: DeltaCandle,
    direction: DisplacementDirection,
    smcCtx?: SmcContext,
  ): PullbackZone {
    const range = candle.high - candle.low;

    // Try to use the FVG midpoint as entry (markets retrace to imbalance)
    const fvgEntry = this.fvgMidpoint(direction, smcCtx);

    if (direction === "BULLISH") {
      const entry = fvgEntry ?? candle.high - range * 0.5;
      return {
        entry,
        stop: candle.low - range * 0.05,
      };
    } else {
      const entry = fvgEntry ?? candle.low + range * 0.5;
      return {
        entry,
        stop: candle.high + range * 0.05,
      };
    }
  }

  /** Find the nearest FVG midpoint matching the displacement direction. */
  private fvgMidpoint(direction: DisplacementDirection, smcCtx?: SmcContext): number | null {
    if (!smcCtx) return null;

    const matching = smcCtx.fvgs.filter((f) => f.type === direction);
    if (matching.length === 0) return null;

    // Use the most recent FVG (last in the list)
    const fvg = matching[matching.length - 1]!;
    return (fvg.top + fvg.bottom) / 2;
  }
}
