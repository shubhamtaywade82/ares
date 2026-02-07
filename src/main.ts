import "dotenv/config";
import { DeltaRestClient } from "./delta/rest.client.js";
import { DeltaWsClient } from "./delta/ws.client.js";
import { MarketCache } from "./market/market.cache.js";
import { bootstrapMarket } from "./market/bootstrap.js";
import { SYMBOLS } from "./market/symbol.registry.js";
import { env } from "./config/env.js";
import { KillSwitch } from "./risk/kill.switch.js";
import { KillReason } from "./risk/kill.reasons.js";
import { IndicatorCache } from "./indicators/indicator.cache.js";
import { runStrategy } from "./strategy/strategy.runner.js";
import { evaluateRisk } from "./risk/risk.evaluator.js";
import { RISK_CONFIG } from "./config/risk.js";
import { computeHTFBias } from "./strategy/bias.htf.js";
import { computeTargets } from "./execution/sltp.manager.js";
import { createAIClientFromEnv } from "./ai/ai.client.js";
import { aiVeto } from "./ai/ai.veto.js";
import { OrderStore } from "./state/order.store.js";
import { OrderManager } from "./execution/order.manager.js";
import { RiskContext } from "./risk/types.js";

type TickerMessage = {
  type?: string;
  price?: number | string;
  volume?: number | string;
  timestamp?: number;
};

const rest = new DeltaRestClient();
const market = new MarketCache();
const indicators = new IndicatorCache(market);
const aiClient = createAIClientFromEnv();
const orderStore = new OrderStore();
const orderManager = new OrderManager(rest, orderStore, env.TRADING_MODE);

let bootstrapped = false;
let lastClosed1m = 0;
let running = false;
let cachedBalance: number | undefined;
let cachedProduct: any;

process.on("SIGINT", () => {
  KillSwitch.trigger(KillReason.MANUAL);
});

let ws: DeltaWsClient | undefined;

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

  try {
    const res = await rest.getProductBySymbol(symbol);
    cachedProduct = res?.result;
  } catch (error) {
    console.warn(`[ARES.MARKET] Failed to load product metadata for ${symbol}:`, error);
  }

  await bootstrapMarket(rest, market, symbol);
  bootstrapped = true;

  ws = new DeltaWsClient(
    (msg: TickerMessage) => {
      const msgType = msg.type;
      const isTicker = msgType === "ticker" || msgType === "v2/ticker";
      if (!isTicker) return;

      const rawPrice =
        (msg as any).mark_price ??
        (msg as any).close ??
        (msg as any).spot_price ??
        msg.price;
      const price = Number(rawPrice);
      const volume = Number(msg.volume ?? 0);
      const rawTs =
        (msg as any).timestamp ??
        (msg as any).ts ??
        (msg as any).time;
      const parsedTs = Number(rawTs);

      if (!Number.isFinite(price) || !Number.isFinite(parsedTs)) {
        return;
      }

      const tsMs = parsedTs > 1e12 ? parsedTs / 1000 : parsedTs;
      market.ingestTick(price, volume, tsMs);
      if (!bootstrapped) return;
      const closed = market.lastClosed("1m");
      if (!closed || closed.timestamp === lastClosed1m) return;
      lastClosed1m = closed.timestamp;
      void onNew1mClose();
    },
    () => {
      console.error("KILL SWITCH TRIGGERED");
      process.exit(1);
    },
    () => {
      console.info("[ARES.MARKET] WS connected; subscribing to ticker");
      ws?.subscribe("v2/ticker", [symbol]);
    }
  );

  ws.connect();
}

bootstrap().catch((e) => {
  console.error("BOOT FAILURE", e);
  process.exit(1);
});

function resolveMinLotSize(product: any): number | undefined {
  const raw =
    product?.min_size ??
    product?.min_order_size ??
    product?.size_increment ??
    product?.lot_size ??
    product?.quantity_step;
  const parsed = typeof raw === "string" ? Number(raw) : raw;
  if (Number.isFinite(parsed) && parsed > 0) return Number(parsed);
  return undefined;
}

function resolveSession(): "ASIA" | "EU" | "US" {
  const hour = new Date().getUTCHours();
  if (hour >= 0 && hour < 7) return "ASIA";
  if (hour >= 7 && hour < 13) return "EU";
  return "US";
}

async function getRiskContext(symbol: string): Promise<RiskContext> {
  let balance = cachedBalance ?? 0;
  try {
    const res = await rest.getBalances();
    const balances = Array.isArray(res?.result) ? res.result : [];
    const preferred =
      balances.find((b: any) => b.asset === "USD") ??
      balances.find((b: any) => b.asset === "USDT") ??
      balances[0];
    const raw = preferred?.available_balance ?? preferred?.balance;
    const parsed = typeof raw === "string" ? Number(raw) : raw;
    if (Number.isFinite(parsed)) {
      balance = Number(parsed);
      cachedBalance = balance;
    }
  } catch (error) {
    console.warn("[ARES.RISK] Failed to fetch balances, using cached value");
  }

  return {
    balance,
    dailyPnl: 0,
    openTrades: 0,
  };
}

async function onNew1mClose() {
  if (running) return;
  running = true;
  try {
    await Promise.all([indicators.update("5m"), indicators.update("15m")]);

    const signal = await runStrategy(market, indicators);
    if (!signal) return;

    const last5m = market.lastClosed("5m");
    if (!last5m) {
      console.warn("[ARES.STRATEGY] Missing 5m close for execution");
      return;
    }

    const ind5m = indicators.snapshot("5m");
    if (!ind5m.atr14) {
      console.warn("[ARES.STRATEGY] Missing 5m ATR for execution");
      return;
    }

    const entryPrice = last5m.close;
    const stopPrice =
      signal.side === "LONG" ? entryPrice - ind5m.atr14 : entryPrice + ind5m.atr14;
    const targetPrice = computeTargets(
      entryPrice,
      stopPrice,
      signal.side,
      RISK_CONFIG.minRR
    );

    const minLotSize = resolveMinLotSize(cachedProduct) ?? 1;
    if (!resolveMinLotSize(cachedProduct) && env.TRADING_MODE === "live") {
      console.warn("[ARES.RISK] Missing min lot size; blocking live execution");
      return;
    }

    const ctx = await getRiskContext(env.DELTA_PRODUCT_SYMBOL ?? SYMBOLS.BTC_USDT.symbol);
    if (ctx.balance <= 0) {
      console.warn("[ARES.RISK] Balance unavailable or zero; blocking execution");
      return;
    }

    const risk = evaluateRisk(ctx, {
      entryPrice,
      stopPrice,
      side: signal.side,
      minLotSize,
    });
    if (!risk.allowed) return;

    const bias = computeHTFBias(market, indicators);
    const ind15m = indicators.snapshot("15m");
    const aiInput = {
      symbol: env.DELTA_PRODUCT_SYMBOL ?? SYMBOLS.BTC_USDT.symbol,
      side: signal.side,
      timeframeBias: {
        htf: bias === "LONG" ? "BULL" : bias === "SHORT" ? "BEAR" : "RANGE",
        rsi: ind15m.rsi14 ?? 50,
        emaSlope:
          market.candles("15m").length >= 2 &&
          market.candles("15m").at(-1)!.close >
            market.candles("15m").at(-2)!.close
            ? "UP"
            : market.candles("15m").length >= 2 &&
                market.candles("15m").at(-1)!.close <
                  market.candles("15m").at(-2)!.close
              ? "DOWN"
              : "FLAT",
      },
      setupQuality: {
        score: signal.score,
        reasons: signal.reasons,
      },
      volatility: {
        atr: ind15m.atr14 ?? ind5m.atr14,
        atrPercentile: 0.5,
      },
      marketContext: {
        session: resolveSession(),
      },
    };

    let aiAllowed = true;
    const aiHealthy = await aiClient.healthCheck(1500);
    if (!aiHealthy) {
      if (env.TRADING_MODE === "paper") {
        console.warn("[ARES.RISK] AI veto unreachable; skipping in paper mode");
      } else {
        console.warn("[ARES.RISK] AI veto unreachable; blocking trade");
        return;
      }
    } else {
      try {
        const ai = await aiVeto(aiClient, aiInput);
        aiAllowed = ai.allowed;
      } catch (error) {
        console.warn("[ARES.RISK] AI veto failed; blocking trade");
        aiAllowed = false;
      }
      if (!aiAllowed) return;
    }

    await orderManager.execute({
      symbol: env.DELTA_PRODUCT_SYMBOL ?? SYMBOLS.BTC_USDT.symbol,
      side: signal.side,
      entryPrice,
      stopPrice,
      targetPrice,
      qty: risk.qty,
    });
  } catch (error) {
    console.error("[ARES.STRATEGY] Cycle failure", error);
  } finally {
    running = false;
  }
}
