import "dotenv/config";
import { env } from "../config/env.js";
import { PaperTrader, PaperTradeConfig } from "./paper.trader.js";
import { SYMBOLS } from "../market/symbol.registry.js";
import { resolveMaxLeverage } from "../config/risk.js";
import { DeltaRestClient } from "../delta/rest.client.js";
import { MarketCache } from "../market/market.cache.js";
import { IndicatorCache } from "../indicators/indicator.cache.js";
import { bootstrapMarket } from "../market/bootstrap.js";
import { runStrategy } from "../strategy/strategy.runner.js";

type SymbolConfig = {
  symbol: string;
};

function normalizeSymbols(): SymbolConfig[] {
  const rawList = env.DELTA_PRODUCT_SYMBOLS;
  if (rawList) {
    return rawList
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => ({ symbol: s.toUpperCase() }));
  }
  if (env.DELTA_PRODUCT_SYMBOL) {
    return [{ symbol: env.DELTA_PRODUCT_SYMBOL.toUpperCase() }];
  }
  return [{ symbol: SYMBOLS.BTC_USDT.symbol }];
}

async function determineSide(symbol: string): Promise<"buy" | "sell" | null> {
  console.log(`\n[ARES.PAPER] Resolving strategy direction for ${symbol}...`);

  const rest = new DeltaRestClient();
  const market = new MarketCache();

  await bootstrapMarket(rest, market, symbol);

  const indicators = new IndicatorCache(market);
  await Promise.all([indicators.update("5m"), indicators.update("15m")]);

  const signal = await runStrategy(market, indicators);
  if (!signal) {
    console.warn(
      `[ARES.PAPER] No strategy setup detected for ${symbol}; skipping paper trade`
    );
    return null;
  }

  const side: "buy" | "sell" = signal.side === "LONG" ? "buy" : "sell";
  console.log(
    `[ARES.PAPER] Strategy selected side=${signal.side} → order side=${side.toUpperCase()}`
  );

  return side;
}

async function run(): Promise<void> {
  const capital = env.PAPER_BALANCE ?? 0;
  if (capital <= 0) {
    console.warn("[ARES.PAPER] PAPER_BALANCE is not set or zero; sizing will be minimal");
  }

  let shouldStop = false;

  const list = normalizeSymbols();
  if (list.length === 0) {
    console.warn("[ARES.PAPER] No symbols configured for paper flow");
    return;
  }

  console.log("=".repeat(60));
  console.log("[ARES.PAPER] Running multi-symbol flow");
  console.log("=".repeat(60));
  console.log(`[ARES.PAPER] Symbols: ${list.map((cfg) => cfg.symbol).join(",")} `);

  const traders: PaperTrader[] = [];
  process.on("SIGINT", () => {
    console.log("[ARES.PAPER] Interrupt received; stopping all flows");
    shouldStop = true;
    traders.forEach((trader) => trader.stop("Interrupted by user"));
  });

  let cycle = 0;
  const scanIntervalMs = 60_000;

  while (!shouldStop) {
    cycle += 1;
    console.log(`\n[ARES.PAPER] === Scan cycle ${cycle} starting ===`);

    for (const cfg of list) {
      if (shouldStop) break;

      const side = await determineSide(cfg.symbol);
      if (!side) {
        continue;
      }

      const trader = new PaperTrader({
        productSymbol: cfg.symbol,
        side,
        productId: env.DELTA_PRODUCT_ID,
        capital,
        leverage: resolveMaxLeverage(cfg.symbol),
        profitTargetPercent: 2,
        stopLossPercent: 1,
        useMarketOrder: env.PAPER_MARKET_ENTRY,
        logEveryMs: 1000,
      });

      traders.push(trader);
      try {
        await trader.run();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`[ARES.PAPER] Paper run failed for ${cfg.symbol}: ${reason}`);
      }
    }

    if (shouldStop) break;

    console.log(
      `[ARES.PAPER] === Scan cycle ${cycle} complete; sleeping ${scanIntervalMs / 1000}s ===`
    );
    await new Promise((resolve) => setTimeout(resolve, scanIntervalMs));
  }

  console.log("[ARES.PAPER] Paper loop stopped");
}

run().catch((error) => {
  console.error("[ARES.PAPER] Flow failed", error);
  process.exit(1);
});
