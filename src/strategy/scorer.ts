import { SetupSignal } from "./types.js";
import { IndicatorSnapshot } from "../indicators/types.js";

export function scoreSetup(
  setup: SetupSignal,
  htfIndicators: IndicatorSnapshot
): SetupSignal | null {
  let score = setup.score;
  const reasons = [...setup.reasons];

  // Trend strength bonus
  if (
    htfIndicators.ema200 !== undefined &&
    htfIndicators.rsi14 !== undefined &&
    Math.abs(htfIndicators.rsi14 - 50) > 10
  ) {
    score += 3;
    reasons.push("Strong HTF trend");
  }

  // Volatility sanity
  if (htfIndicators.atr14 !== undefined && htfIndicators.atr14 > 0) {
    score += 1;
    reasons.push("ATR healthy");
  }

  if (score < 7) return null;

  return { ...setup, score, reasons };
}
