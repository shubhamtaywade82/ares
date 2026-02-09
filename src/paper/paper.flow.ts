import "dotenv/config";
import { env } from "../config/env.js";
import { PaperTrader } from "./paper.trader.js";
import { LiveTrader } from "./live.trader.js";
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

const BTC_MIN_CAPITAL = 20_000;

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

function isSymbolEligible(symbol: string, capital: number): boolean {
  const upper = symbol.toUpperCase();
  if (upper.startsWith("BTC") && capital < BTC_MIN_CAPITAL && env.TRADING_MODE === "paper") {
    console.log(
      `[ARES.${MODE_TAG}] Skipping ${upper} — capital ₹${capital} < BTC min ₹${BTC_MIN_CAPITAL}`
    );
    return false;
  }
  return true;
}

const MODE_TAG = env.TRADING_MODE === "live" ? "LIVE" : "PAPER";

async function determineSide(symbol: string): Promise<"buy" | "sell" | null> {
  console.log(`\n[ARES.${MODE_TAG}] Resolving strategy direction for ${symbol}...`);

  const rest = new DeltaRestClient();
  const market = new MarketCache();

  await bootstrapMarket(rest, market, symbol);

  const indicators = new IndicatorCache(market);
  await Promise.all([indicators.update("5m"), indicators.update("15m")]);

  const signal = await runStrategy(market, indicators);
  if (!signal) {
    console.warn(
      `[ARES.${MODE_TAG}] No strategy setup detected for ${symbol}; skipping trade`
    );
    return null;
  }

  const side: "buy" | "sell" = signal.side === "LONG" ? "buy" : "sell";
  console.log(
    `[ARES.${MODE_TAG}] Strategy selected side=${signal.side} → order side=${side.toUpperCase()}`
  );

  return side;
}

async function run(): Promise<void> {
  const isLive = env.TRADING_MODE === "live";
  const capital = isLive ? 0 : (env.PAPER_BALANCE ?? 0);

  if (!isLive && capital <= 0) {
    console.warn(`[ARES.${MODE_TAG}] PAPER_BALANCE is not set or zero; sizing will be minimal`);
  }

  let shouldStop = false;

  const configured = normalizeSymbols();
  const list = configured.filter((cfg) => isSymbolEligible(cfg.symbol, capital));
  if (list.length === 0) {
    console.warn(`[ARES.${MODE_TAG}] No symbols configured for trading flow`);
    return;
  }

  console.log("=".repeat(60));
  console.log(`[ARES.${MODE_TAG}] Running multi-symbol ${env.TRADING_MODE} flow`);
  console.log("=".repeat(60));
  console.log(`[ARES.${MODE_TAG}] Symbols: ${list.map((cfg) => cfg.symbol).join(",")} `);

  const traders: (PaperTrader | LiveTrader)[] = [];
  process.on("SIGINT", () => {
    console.log(`[ARES.${MODE_TAG}] Interrupt received; stopping all flows`);
    shouldStop = true;
    traders.forEach((trader) => trader.stop("Interrupted by user"));
  });

  let cycle = 0;
  const scanIntervalMs = 60_000;

  while (!shouldStop) {
    cycle += 1;
    console.log(`\n[ARES.${MODE_TAG}] === Scan cycle ${cycle} starting ===`);

    for (const cfg of list) {
      if (shouldStop) break;

      const side = await determineSide(cfg.symbol);
      if (!side) {
        continue;
      }

      if (isLive) {
        const trader = new LiveTrader({
          productSymbol: cfg.symbol,
          side,
          productId: env.DELTA_PRODUCT_ID,
          capital: 0,
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
          console.error(`[ARES.${MODE_TAG}] Live run failed for ${cfg.symbol}: ${reason}`);
        }
      } else {
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
          console.error(`[ARES.${MODE_TAG}] Paper run failed for ${cfg.symbol}: ${reason}`);
        }
      }
    }

    if (shouldStop) break;

    console.log(
      `[ARES.${MODE_TAG}] === Scan cycle ${cycle} complete; sleeping ${scanIntervalMs / 1000}s ===`
    );
    await new Promise((resolve) => setTimeout(resolve, scanIntervalMs));
  }

  console.log(`[ARES.${MODE_TAG}] Trading loop stopped`);
}

run().catch((error) => {
  console.error(`[ARES.${MODE_TAG}] Flow failed`, error);
  process.exit(1);
});
