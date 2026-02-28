import { CandleBuilder } from "./candle.builder.js";
import { DeltaCandle } from "../delta/types.js";
import { logger } from "../utils/logger.js";

type Timeframe = "1m" | "5m" | "15m";

export class MarketCache {
  private builders: Map<Timeframe, CandleBuilder> = new Map();
  private latestPrice = 0;

  constructor() {
    this.builders.set("1m", new CandleBuilder(1));
    this.builders.set("5m", new CandleBuilder(5));
    this.builders.set("15m", new CandleBuilder(15));
  }

  bootstrap(tf: Timeframe, candles: any[]) {
    const builder = this.builders.get(tf);
    if (!builder) throw new Error(`Unknown timeframe ${tf}`);

    // Delta REST candles use `time` (Unix seconds); our internal type uses `timestamp` (ms).
    // Cast all fields from string → number since the API returns strings for OHLCV.
    const normalized: DeltaCandle[] = candles.map((c) => ({
      timestamp: (typeof c.time === "string" ? Number(c.time) : (c.time ?? c.timestamp)) * 1000,
      open: typeof c.open === "string" ? Number(c.open) : c.open,
      high: typeof c.high === "string" ? Number(c.high) : c.high,
      low: typeof c.low === "string" ? Number(c.low) : c.low,
      close: typeof c.close === "string" ? Number(c.close) : c.close,
      volume: typeof c.volume === "string" ? Number(c.volume) : c.volume,
    }));

    builder.bootstrap(normalized);
    logger.info(`[ARES.MARKET] Cached ${normalized.length} candles for ${tf}`);
  }

  ingestTick(price: number, volume: number, timestamp: number) {
    this.latestPrice = price;
    for (const builder of this.builders.values()) {
      builder.ingestTick(price, volume, timestamp);
    }
  }

  lastPrice(): number {
    return this.latestPrice;
  }

  candles(tf: Timeframe): readonly DeltaCandle[] {
    const builder = this.builders.get(tf);
    if (!builder) throw new Error(`Unknown timeframe ${tf}`);
    return builder.getCandles();
  }

  lastClosed(tf: Timeframe): DeltaCandle | undefined {
    const builder = this.builders.get(tf);
    if (!builder) throw new Error(`Unknown timeframe ${tf}`);
    return builder.lastClosed();
  }
}
