import { MarketCache } from "../market/market.cache.js";
import { IndicatorSnapshot, Timeframe } from "./types.js";
import { computeEMA } from "./ema.js";
import { computeRSI } from "./rsi.js";
import { computeATR } from "./atr.js";
import { computeVWAP } from "./vwap.js";
import { logger } from "../utils/logger.js";

export class IndicatorCache {
  private cache: Map<Timeframe, IndicatorSnapshot> = new Map();

  constructor(private market: MarketCache) {}

  async update(tf: Timeframe): Promise<void> {
    const candles = this.market.candles(tf);
    logger.info(`[ARES.INDICATORS] Computing indicators for ${tf} (${candles.length} candles)`);

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

    const snapshot: IndicatorSnapshot = { ready };
    if (ema20 !== undefined) snapshot.ema20 = ema20;
    if (ema200 !== undefined) snapshot.ema200 = ema200;
    if (rsi14 !== undefined) snapshot.rsi14 = rsi14;
    if (atr14 !== undefined) snapshot.atr14 = atr14;
    if (vwap !== undefined) snapshot.vwap = vwap;

    this.cache.set(tf, snapshot);
    logger.info(`[ARES.INDICATORS] ${tf} ready=${snapshot.ready}`);
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
