import { eventBus, MarketEventType } from "../market/event.bus.js";
import { Candle } from "./types.js";

/**
 * Convert historical OHLC candles into TICK events on the event bus.
 *
 * Each candle generates 4 ticks (open → high → low → close order), simulating
 * intra-candle price movement. This is a simplification — for higher fidelity,
 * use actual tick data if available.
 */
export const replayCandles = async (candles: Candle[]): Promise<void> => {
  for (const c of candles) {
    // Emit open, high, low, close as sequential ticks
    const prices = [c.open, c.high, c.low, c.close];

    for (const price of prices) {
      eventBus.emitRaw(
        MarketEventType.TICK,
        {
          symbol: c.symbol,
          price,
          volume: c.volume,
          timestamp: c.timestamp,
        },
        true // suppressPersist — don't write backtest ticks to live event store
      );

      // Yield to allow async listeners to process before next tick
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
};
