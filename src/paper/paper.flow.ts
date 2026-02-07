import "dotenv/config";
import { env } from "../config/env.js";
import { PaperTrader, PaperTradeConfig } from "./paper.trader.js";
import { SYMBOLS } from "../market/symbol.registry.js";

const PAPER_FLOW_CONFIG: PaperTradeConfig = {
  productSymbol: env.DELTA_PRODUCT_SYMBOL ?? SYMBOLS.BTC_USDT.symbol,
  productId: env.DELTA_PRODUCT_ID,
  capital: env.PAPER_BALANCE ?? 0,
  leverage: 10,
  profitTargetPercent: 2,
  stopLossPercent: 1,
  side: "buy",
  useMarketOrder: false,
  logEveryMs: 1000,
};

async function run() {
  if (env.TRADING_MODE !== "paper") {
    console.warn("[ARES.PAPER] TRADING_MODE is not paper; continuing anyway");
  }
  if (env.PAPER_BALANCE == null || env.PAPER_BALANCE <= 0) {
    console.warn("[ARES.PAPER] PAPER_BALANCE is not set or zero; sizing will be minimal");
  }

  const trader = new PaperTrader(PAPER_FLOW_CONFIG);
  await trader.run();
}

run().catch((error) => {
  console.error("[ARES.PAPER] Flow failed", error);
  process.exit(1);
});
