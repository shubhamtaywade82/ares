import "dotenv/config";
import { env } from "../config/env.js";
import { PaperTrader, PaperTradeConfig } from "./paper.trader.js";
import { SYMBOLS } from "../market/symbol.registry.js";
import { resolveMaxLeverage } from "../config/risk.js";

type SymbolConfig = {
  symbol: string;
  side: "buy" | "sell";
};

function normalizeSymbols(): SymbolConfig[] {
  const rawList = env.DELTA_PRODUCT_SYMBOLS;
  const defaultSide = env.PAPER_SIDE === "sell" ? "sell" : "buy";
  if (rawList) {
    return rawList
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => ({ symbol: s.toUpperCase(), side: defaultSide }));
  }
  if (env.DELTA_PRODUCT_SYMBOL) {
    return [{ symbol: env.DELTA_PRODUCT_SYMBOL.toUpperCase(), side: defaultSide }];
  }
  return [{ symbol: SYMBOLS.BTC_USDT.symbol, side: defaultSide }];
}

async function run(): Promise<void> {
  const capital = env.PAPER_BALANCE ?? 0;
  if (capital <= 0) {
    console.warn("[ARES.PAPER] PAPER_BALANCE is not set or zero; sizing will be minimal");
  }

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
    traders.forEach((trader) => trader.stop("Interrupted by user"));
  });

  const runs = list.map(async (cfg) => {
    const trader = new PaperTrader({
      ...cfg,
      productId: env.DELTA_PRODUCT_ID,
      capital,
      leverage: resolveMaxLeverage(cfg.symbol),
      profitTargetPercent: 2,
      stopLossPercent: 1,
      useMarketOrder: env.PAPER_MARKET_ENTRY,
      logEveryMs: 1000,
    });
    traders.push(trader);
    return trader.run();
  });

  await Promise.all(runs);
  console.log("[ARES.PAPER] All symbol flows completed");
}

run().catch((error) => {
  console.error("[ARES.PAPER] Flow failed", error);
  process.exit(1);
});
