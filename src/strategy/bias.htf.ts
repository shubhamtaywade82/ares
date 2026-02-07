import { MarketCache } from "../market/market.cache.js";
import { IndicatorCache } from "../indicators/indicator.cache.js";
import { Bias } from "./types.js";

export function computeHTFBias(
  market: MarketCache,
  indicators: IndicatorCache
): Bias {
  const candles = market.candles("15m");
  const ind = indicators.snapshot("15m");

  if (!ind.ready || candles.length < 3) {
    console.info(
      `[ARES.STRATEGY] HTF not ready: ready=${ind.ready} candles=${candles.length}`
    );
    return "NONE";
  }

  const last = candles.at(-1)!;
  const prev = candles.at(-2)!;
  const prev2 = candles.at(-3)!;

  if (ind.ema200 === undefined || ind.rsi14 === undefined) {
    console.info(
      `[ARES.STRATEGY] HTF missing indicators: ema200=${String(
        ind.ema200
      )} rsi14=${String(ind.rsi14)}`
    );
    return "NONE";
  }

  if (last.close > ind.ema200 && ind.rsi14 > 55) {
    return "LONG";
  }

  if (last.close < ind.ema200 && ind.rsi14 < 45) {
    return "SHORT";
  }

  console.info(
    `[ARES.STRATEGY] HTF bias NONE: ema200=${ind.ema200.toFixed(
      2
    )} rsi14=${ind.rsi14.toFixed(2)} last=${JSON.stringify(
      last
    )} prev=${JSON.stringify(prev)} prev2=${JSON.stringify(prev2)}`
  );
  return "NONE";
}
