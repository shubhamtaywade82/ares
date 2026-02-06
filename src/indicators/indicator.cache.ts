import { MarketCache } from "../market/market.cache.js";
import { IndicatorSnapshot, Timeframe } from "./types.js";
import { computeEMA } from "./ema.js";
import { computeRSI } from "./rsi.js";
import { computeATR } from "./atr.js";
import { computeVWAP } from "./vwap.js";

export class IndicatorCache {
  private cache: Map<Timeframe, IndicatorSnapshot> = new Map();

  constructor(private market: MarketCache) {}

  async update(tf: Timeframe): Promise<void> {
    const candles = this.market.candles(tf);

    const ema20 = computeEMA(candles, 20);
    const ema200 = computeEMA(candles, 200);
    const rsi14 = computeRSI(candles, 14);

    const [atr14, vwap] = await Promise.all([
      computeATR(candles, 14),
      computeVWAP(candles),
    ]);

    const ready =
      ema20 !== undefined &&
      ema200 !== undefined &&
      rsi14 !== undefined &&
      atr14 !== undefined &&
      vwap !== undefined;

    this.cache.set(tf, {
      ema20,
      ema200,
      rsi14,
      atr14,
      vwap,
      ready,
    });
  }

  snapshot(tf: Timeframe): IndicatorSnapshot {
    const snap = this.cache.get(tf);
    if (!snap) return { ready: false };
    return snap;
  }

  isReady(tf: Timeframe): boolean {
    return this.snapshot(tf).ready;
  }
}
