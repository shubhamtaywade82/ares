import "dotenv/config";
import { DeltaRestClient } from "./src/delta/rest.client.js";
import { MarketCache } from "./src/market/market.cache.js";
import { IndicatorCache } from "./src/indicators/indicator.cache.js";
import { bootstrapMarket } from "./src/market/bootstrap.js";
import { AIClient } from "./src/ai/ai.client.js";

async function main() {
  const symbol = "XRPUSD";
  console.log(`Fetching real market data for ${symbol}...`);

  const rest = new DeltaRestClient();
  const market = new MarketCache();

  await bootstrapMarket(rest, market, symbol);

  const indicators = new IndicatorCache(market);
  await indicators.update("15m");
  await indicators.update("5m");

  const lastPrice = market.candles("1m").at(-1)?.close;
  const ind15m = indicators.snapshot("15m");
  const ind5m = indicators.snapshot("5m");

  const contextData = {
    symbol,
    lastPrice,
    indicators15m: {
      ema20: ind15m.ema20,
      ema200: ind15m.ema200,
      rsi14: ind15m.rsi14,
      atr14: ind15m.atr14,
      vwap: ind15m.vwap,
    },
    indicators5m: {
      ema20: ind5m.ema20,
      ema200: ind5m.ema200,
      rsi14: ind5m.rsi14,
      atr14: ind5m.atr14,
      vwap: ind5m.vwap,
    }
  };

  console.log("Market Context Data:\n", JSON.stringify(contextData, null, 2));

  const client = new AIClient({ provider: "ollama", ollamaModel: "qwen3:latest" });

  const promptContent = `
You are a professional crypto technical analyst.
Provide a brief, 3-sentence technical analysis view on ${symbol} based ONLY on the following real-time market data.

Market Data:
${JSON.stringify(contextData, null, 2)}
`;

  console.log("\nQuerying Ollama with real market data...");
  const response = await client.analyze({ role: "user", content: promptContent }, 60000);
  console.log("\nOllama Analysis Response:\n", response);
}

main().catch(console.error);
