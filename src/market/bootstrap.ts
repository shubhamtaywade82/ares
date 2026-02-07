import { DeltaRestClient } from "../delta/rest.client.js";
import { MarketCache } from "./market.cache.js";

export async function bootstrapMarket(
  rest: DeltaRestClient,
  cache: MarketCache,
  symbol: string
) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 60 * 60 * 24 * 2;
  const results = await Promise.allSettled([
    rest.getCandles(symbol, "1m", start, end),
    rest.getCandles(symbol, "5m", start, end),
    rest.getCandles(symbol, "15m", start, end),
  ]);

  const tfs: Array<"1m" | "5m" | "15m"> = ["1m", "5m", "15m"];
  results.forEach((result, index) => {
    const tf = tfs[index];
    if (result.status === "fulfilled") {
      cache.bootstrap(tf, result.value.result);
      return;
    }

    const reason =
      result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.error(`[ARES.MARKET] Bootstrap failed for ${tf}: ${reason}`);
    cache.bootstrap(tf, []);
  });
}
