import "dotenv/config";
import { DeltaRestClient } from "./src/delta/rest.client.js";
import { MarketCache } from "./src/market/market.cache.js";
import { IndicatorCache } from "./src/indicators/indicator.cache.js";
import { bootstrapMarket } from "./src/market/bootstrap.js";
import { AIClient } from "./src/ai/ai.client.js";
import { aiVeto } from "./src/ai/ai.veto.js";
import { StructureAnalyzer } from "./src/strategy/structure.js";
import { SmcAnalyzer } from "./src/strategy/smc.js";
import { AIVetoInput } from "./src/ai/ai.types.js";

// Mocking the resolveSession function since we don't want to import main.ts and start the whole app
function resolveSession(): "ASIA" | "EU" | "US" {
  const hour = new Date().getUTCHours();
  if (hour >= 0 && hour < 7) return "ASIA";
  if (hour >= 7 && hour < 13) return "EU";
  return "US";
}

async function main() {
  const symbol = "XRPUSD";
  console.log(`\n[TEST] Simulating AI Decision Flow for ${symbol}...`);

  const rest = new DeltaRestClient();
  const market = new MarketCache();
  const structure = new StructureAnalyzer();
  const smc = new SmcAnalyzer();

  await bootstrapMarket(rest, market, symbol);
  const candles15m = market.candles("15m");
  structure.update(candles15m);
  smc.update(candles15m, structure.lastBreaks, structure.lastSwings);

  const indicators = new IndicatorCache(market);
  await Promise.all([indicators.update("15m"), indicators.update("5m")]);

  const ind15m = indicators.snapshot("15m");
  const ind5m = indicators.snapshot("5m");
  const entryPrice = market.candles("1m").at(-1)?.close ?? 0;

  console.log(`[TEST] Current Price: ${entryPrice}`);

  const aiInput: AIVetoInput = {
    intent: "ENTRY",
    symbol,
    lastPrice: entryPrice,
    side: "LONG",
    timeframeBias: {
      htf: "BULL",
      rsi: ind15m.rsi14 ?? 50,
      emaSlope: "UP",
    },
    setupQuality: {
      score: 7,
      reasons: ["Bullish Engulfing", "OB Bounce"],
    },
    volatility: {
      atr: ind15m.atr14 ?? 0,
      atrPercentile: 0.5,
    },
    indicators: {
      ema20: ind5m.ema20 ?? 0,
      ema200: ind5m.ema200 ?? 0,
      vwap: ind5m.vwap ?? 0,
    },
    marketContext: {
      session: resolveSession(),
      smc: {
        activeSweep: smc.activeSweep?.type,
        nearestBullishOb: smc.nearestOB(entryPrice, "BULLISH") ?? undefined,
      }
    }
  };

  const client = new AIClient({ provider: "ollama", ollamaModel: "qwen3:0.6b" });

  console.log("[TEST] Sending to AI and checking logs...\n");
  const result = await aiVeto(client, aiInput);

  console.log("\n[TEST] Final Result:", result);
}

main().catch(console.error);
