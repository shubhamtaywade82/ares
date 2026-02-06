import { CandleBuilder } from "./candle.builder.js";
import { DeltaCandle } from "../delta/types.js";

type Timeframe = "1m" | "5m" | "15m";

export class MarketCache {
  private builders: Map<Timeframe, CandleBuilder> = new Map();

  constructor() {
    this.builders.set("1m", new CandleBuilder(1));
    this.builders.set("5m", new CandleBuilder(5));
    this.builders.set("15m", new CandleBuilder(15));
  }

  bootstrap(tf: Timeframe, candles: DeltaCandle[]) {
    const builder = this.builders.get(tf);
    if (!builder) throw new Error(`Unknown timeframe ${tf}`);
    builder.bootstrap(candles);
  }

  ingestTick(price: number, volume: number, timestamp: number) {
    for (const builder of this.builders.values()) {
      builder.ingestTick(price, volume, timestamp);
    }
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
