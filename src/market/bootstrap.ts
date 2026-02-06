import { DeltaRestClient } from "../delta/rest.client.js";
import { MarketCache } from "./market.cache.js";

export async function bootstrapMarket(
  rest: DeltaRestClient,
  cache: MarketCache,
  symbol: string
) {
  const [m1, m5, m15] = await Promise.all([
    rest.getCandles(symbol, "1m"),
    rest.getCandles(symbol, "5m"),
    rest.getCandles(symbol, "15m"),
  ]);

  cache.bootstrap("1m", m1.result);
  cache.bootstrap("5m", m5.result);
  cache.bootstrap("15m", m15.result);
}
