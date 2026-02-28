import { MarketCache } from "../market/market.cache.js";
import { IndicatorCache } from "../indicators/indicator.cache.js";
import { Bias } from "./types.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { StructureAnalyzer } from "./structure.js";

export function computeHTFBias(
  market: MarketCache,
  indicators: IndicatorCache,
  structure?: StructureAnalyzer
): Bias {
  if (env.FORCE_HTF_BIAS) {
    logger.info(`[ARES.STRATEGY] Forced HTF bias=${env.FORCE_HTF_BIAS}`);
    return env.FORCE_HTF_BIAS;
  }

  // 1. Priority: Market Structure Bias
  if (structure) {
    const structuralBias = structure.lastBias;
    if (structuralBias === "BULLISH") return "LONG";
    if (structuralBias === "BEARISH") return "SHORT";
  }

  // 2. Fallback: Traditional Indicator Bias
  const candles = market.candles("15m");
  const ind = indicators.snapshot("15m");

  if (!ind.ready || candles.length < 3) return "NONE";

  const last = candles.at(-1)!;

  if (ind.ema200 === undefined || ind.rsi14 === undefined) return "NONE";

  const ema200Gap = (last.close - ind.ema200) / ind.ema200;

  // Symmetric AND logic: trending price + RSI confirmation
  if (ema200Gap > 0.003 && ind.rsi14 >= 53) return "LONG";
  if (ema200Gap < -0.003 && ind.rsi14 <= 47) return "SHORT";

  // Neutral band or conflicting signals
  return "NONE";
}
