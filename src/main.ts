import "dotenv/config";
import { DeltaRestClient } from "./delta/rest.client.js";
import { DeltaWsClient } from "./delta/ws.client.js";
import { MarketCache } from "./market/market.cache.js";
import { bootstrapMarket } from "./market/bootstrap.js";
import { SYMBOLS } from "./market/symbol.registry.js";
import { env } from "./config/env.js";
import { KillSwitch } from "./risk/kill.switch.js";
import { KillReason } from "./risk/kill.reasons.js";

type TickerMessage = {
  type?: string;
  price?: number | string;
  volume?: number | string;
  timestamp?: number;
};

const rest = new DeltaRestClient();
const market = new MarketCache();

process.on("SIGINT", () => {
  KillSwitch.trigger(KillReason.MANUAL);
});

const ws = new DeltaWsClient(
  (msg: TickerMessage) => {
    if (msg.type === "ticker") {
      const price = Number(msg.price);
      const volume = Number(msg.volume);
      const timestamp = Number(msg.timestamp);

      if (Number.isFinite(price) && Number.isFinite(volume) && Number.isFinite(timestamp)) {
        market.ingestTick(price, volume, timestamp);
      }
    }
  },
  () => {
    console.error("KILL SWITCH TRIGGERED");
    process.exit(1);
  }
);

async function resolveProductIdBySymbol(rest: DeltaRestClient, symbol: string) {
  try {
    const res = await rest.getProductBySymbol(symbol);
    const rawId = res?.result?.id ?? res?.result?.product_id ?? res?.result?.productId;
    const id = typeof rawId === "string" ? Number(rawId) : rawId;
    if (Number.isFinite(id)) return Number(id);
  } catch (error) {
    console.error(`[ARES.MARKET] Failed to resolve product id for ${symbol}:`, error);
  }

  try {
    const res = await rest.getProducts({
      contract_types: "perpetual_futures",
      states: "live",
    });
    const match = res.result.find(
      (p: { symbol?: string; id?: number | string; product_id?: number | string }) =>
        typeof p.symbol === "string" && p.symbol.toUpperCase() === symbol.toUpperCase()
    );
    const rawId = match?.id ?? match?.product_id;
    const id = typeof rawId === "string" ? Number(rawId) : rawId;
    if (Number.isFinite(id)) return Number(id);
  } catch (error) {
    console.error(
      `[ARES.MARKET] Failed to resolve product id from products list for ${symbol}:`,
      error
    );
  }

  return undefined;
}

async function bootstrap() {
  const defaultSymbol = SYMBOLS.BTC_USDT.symbol;
  const symbol = env.DELTA_PRODUCT_SYMBOL ?? defaultSymbol;
  const productId =
    env.DELTA_PRODUCT_ID ?? (await resolveProductIdBySymbol(rest, symbol));

  console.log(`[ARES.MARKET] Using product ${symbol} (id: ${productId ?? "unknown"})`);

  await bootstrapMarket(rest, market, symbol);
  ws.connect();
}

bootstrap().catch((e) => {
  console.error("BOOT FAILURE", e);
  process.exit(1);
});
