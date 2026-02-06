import { MarketCache } from "../market/market.cache.js";
import { IndicatorCache } from "../indicators/indicator.cache.js";
import { Bias } from "./types.js";

export function computeHTFBias(
  market: MarketCache,
  indicators: IndicatorCache
): Bias {
  const candles = market.candles("15m");
  const ind = indicators.snapshot("15m");

  if (!ind.ready || candles.length < 3) return "NONE";

  const last = candles.at(-1)!;
  const prev = candles.at(-2)!;
  const prev2 = candles.at(-3)!;

  if (ind.ema200 === undefined || ind.rsi14 === undefined) return "NONE";

  const hh = last.high > prev.high && prev.high > prev2.high;
  const hl = last.low > prev.low && prev.low > prev2.low;

  const lh = last.high < prev.high && prev.high < prev2.high;
  const ll = last.low < prev.low && prev.low < prev2.low;

  if (last.close > ind.ema200 && ind.rsi14 > 50 && hh && hl) {
    return "LONG";
  }

  if (last.close < ind.ema200 && ind.rsi14 < 50 && lh && ll) {
    return "SHORT";
  }

  return "NONE";
}
