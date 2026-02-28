import { MarketCache } from "../market/market.cache.js";
import { IndicatorCache } from "../indicators/indicator.cache.js";
import { Bias } from "./types.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export function computeHTFBias(
  market: MarketCache,
  indicators: IndicatorCache
): Bias {
  if (env.FORCE_HTF_BIAS) {
    logger.info(`[ARES.STRATEGY] Forced HTF bias=${env.FORCE_HTF_BIAS}`);
    return env.FORCE_HTF_BIAS;
  }

  const candles = market.candles("15m");
  const ind = indicators.snapshot("15m");

  if (!ind.ready || candles.length < 3) {
    logger.info(
      `[ARES.STRATEGY] HTF not ready: ready=${ind.ready} candles=${candles.length}`
    );
    return "NONE";
  }

  const last = candles.at(-1)!;
  const prev = candles.at(-2)!;
  const prev2 = candles.at(-3)!;

  if (ind.ema200 === undefined || ind.rsi14 === undefined) {
    logger.info(
      `[ARES.STRATEGY] HTF missing indicators: ema200=${String(
        ind.ema200
      )} rsi14=${String(ind.rsi14)}`
    );
    return "NONE";
  }

  const priceAboveEma = last.close >= ind.ema200;
  const distanceFromEma = Math.abs(last.close - ind.ema200) / ind.ema200;

  // Small neutral band very close to EMA and mid RSI to occasionally return NONE
  if (distanceFromEma < 0.002 && ind.rsi14 >= 48 && ind.rsi14 <= 52) {
    logger.info(
      `[ARES.STRATEGY] HTF bias NONE (neutral band): ema200=${ind.ema200.toFixed(
        2
      )} rsi14=${ind.rsi14.toFixed(2)} last=${JSON.stringify(
        last
      )} prev=${JSON.stringify(prev)} prev2=${JSON.stringify(prev2)}`
    );
    return "NONE";
  }

  if (priceAboveEma || ind.rsi14 >= 50) {
    return "LONG";
  }

  return "SHORT";
}
