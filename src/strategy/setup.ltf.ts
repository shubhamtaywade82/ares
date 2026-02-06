import { MarketCache } from "../market/market.cache.js";
import { IndicatorCache } from "../indicators/indicator.cache.js";
import { Bias, SetupSignal } from "./types.js";

export function detectLTFSetup(
  bias: Bias,
  market: MarketCache,
  indicators: IndicatorCache
): SetupSignal | null {
  if (bias === "NONE") return null;

  const candles = market.candles("5m");
  const ind = indicators.snapshot("5m");

  if (!ind.ready || candles.length < 2) return null;
  if (
    ind.ema20 === undefined ||
    ind.atr14 === undefined ||
    ind.vwap === undefined ||
    ind.rsi14 === undefined
  ) {
    return null;
  }

  const last = candles.at(-1)!;
  const prev = candles.at(-2)!;

  const nearValue =
    Math.abs(last.close - ind.ema20) <= ind.atr14 * 0.5 ||
    Math.abs(last.close - ind.vwap) <= ind.atr14 * 0.5;

  const bullish = last.close > last.open;
  const bearish = last.close < last.open;

  const reasons: string[] = [];
  let score = 0;

  if (bias === "LONG") {
    if (nearValue) {
      score += 2;
      reasons.push("Pullback to value");
    }
    if (ind.rsi14 > 40) {
      score += 2;
      reasons.push("RSI support");
    }
    if (bullish) {
      score += 2;
      reasons.push("Bullish close");
    }
    return { side: "LONG", score, reasons };
  }

  if (bias === "SHORT") {
    if (nearValue) {
      score += 2;
      reasons.push("Pullback to value");
    }
    if (ind.rsi14 < 60) {
      score += 2;
      reasons.push("RSI rejection");
    }
    if (bearish) {
      score += 2;
      reasons.push("Bearish close");
    }
    return { side: "SHORT", score, reasons };
  }

  return null;
}
