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

  // 1. Structural Bias Check (Multi-TF)
  const bias1d = computeStructuralBias(market, "1d");
  const bias4h = computeStructuralBias(market, "4h");
  const bias1h = computeStructuralBias(market, "1h");

  if (bias1d === "BEARISH" && bias4h === "BEARISH" && bias1h === "BEARISH") {
    return "SHORT";
  }
  if (bias1d === "BULLISH" && bias4h === "BULLISH" && bias1h === "BULLISH") {
    return "LONG";
  }

  // 2. Fallback: Traditional Indicator Bias on 15m
  const candles = market.candles("15m");
  const ind = indicators.snapshot("15m");

  if (!ind.ready || candles.length < 3) return "NONE";

  const last = candles.at(-1)!;

  if (ind.ema200 === undefined || ind.rsi14 === undefined) return "NONE";

  const ema200Gap = (last.close - ind.ema200) / ind.ema200;

  // Symmetric AND logic: trending price + RSI confirmation
  if (ema200Gap > 0.003 && ind.rsi14 >= 53) return "LONG";
  if (ema200Gap < -0.003 && ind.rsi14 <= 47) return "SHORT";

  return "NONE";
}

/**
 * Quick structural bias check for a specific timeframe without full StructureAnalyzer state.
 * Uses EMA200 for simplicity as a proxy for structural trend in HTF if StructureAnalyzer is only for execution TF.
 */
function computeStructuralBias(market: MarketCache, tf: string): "BULLISH" | "BEARISH" | "NONE" {
  const candles = market.candles(tf as any);
  if (candles.length < 200) return "NONE";
  
  const last = candles.at(-1)!;
  // Simple EMA200 proxy for HTF structure if we don't want to maintain 4 separate StructureAnalyzers yet
  // In a more complex setup, we'd have a StructureAnalyzer per timeframe.
  // For now, let's use a simple price vs SMA cross for HTF.
  let sum = 0;
  let count = 0;
  for (let i = candles.length - 200; i < candles.length; i++) {
    const c = candles[i];
    if (c) {
      sum += c.close;
      count++;
    }
  }
  if (count === 0) return "NONE";
  const sma200 = sum / count;

  return last.close > sma200 ? "BULLISH" : "BEARISH";
}
