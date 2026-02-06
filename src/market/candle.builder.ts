import { DeltaCandle } from "../delta/types.js";

export class CandleBuilder {
  private candles: DeltaCandle[] = [];
  private readonly intervalMs: number;

  constructor(intervalMinutes: number) {
    this.intervalMs = intervalMinutes * 60_000;
  }

  bootstrap(initial: DeltaCandle[]) {
    if (this.candles.length > 0) {
      throw new Error("CandleBuilder already bootstrapped");
    }

    // assume REST candles are sorted
    this.candles = [...initial];
  }

  ingestTick(price: number, volume: number, timestamp: number) {
    const bucket = Math.floor(timestamp / this.intervalMs) * this.intervalMs;
    const last = this.candles[this.candles.length - 1];

    // case 1: first WS tick after bootstrap
    if (!last) {
      this.candles.push({
        timestamp: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      });
      return;
    }

    // case 2: same candle
    if (last.timestamp === bucket) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += volume;
      return;
    }

    // case 3: new candle (forward only)
    if (bucket > last.timestamp) {
      this.candles.push({
        timestamp: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      });
    }

    // case 4: out-of-order tick -> ignore
  }

  getCandles(): readonly DeltaCandle[] {
    return this.candles;
  }

  lastClosed(): DeltaCandle | undefined {
    return this.candles.length > 1
      ? this.candles[this.candles.length - 2]
      : undefined;
  }
}
