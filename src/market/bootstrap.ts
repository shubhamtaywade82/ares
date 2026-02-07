import { DeltaRestClient } from "../delta/rest.client.js";
import { MarketCache } from "./market.cache.js";

export async function bootstrapMarket(
  rest: DeltaRestClient,
  cache: MarketCache,
  symbol: string
) {
  const end = Math.floor(Date.now() / 1000);
  const timeframes: Array<{ tf: "1m" | "5m" | "15m"; lookbackSeconds: number }> = [
    { tf: "1m", lookbackSeconds: 60 * 60 * 6 },
    { tf: "5m", lookbackSeconds: 60 * 60 * 24 * 3 },
    { tf: "15m", lookbackSeconds: 60 * 60 * 24 * 7 },
  ];

  for (const { tf, lookbackSeconds } of timeframes) {
    try {
      const start = end - lookbackSeconds;
      const startedAt = Date.now();
      console.info(
        `[ARES.MARKET] Bootstrapping ${tf} from ${start} to ${end} (limit 200)...`
      );
      const result = await rest.getCandles(symbol, tf, start, end, 200, {
        timeoutMs: 30_000,
        retries: 3,
        retryBaseDelayMs: 1000,
        retryMaxDelayMs: 8000,
      });
      const elapsedMs = Date.now() - startedAt;
      console.info(
        `[ARES.MARKET] Bootstrap ${tf} succeeded (${result.result.length} candles in ${elapsedMs}ms)`
      );
      cache.bootstrap(tf, result.result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[ARES.MARKET] Bootstrap failed for ${tf}: ${reason}`);
      cache.bootstrap(tf, []);
    }
  }
}
