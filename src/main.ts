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
import { PaperExecutor } from "./execution/paper.executor.js";
import { PositionStore } from "./state/position.store.js";
import { PnlTracker } from "./state/pnl.tracker.js";
import { OcoManager } from "./execution/oco.manager.js";

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
const positions = new PositionStore();
const pnl = new PnlTracker();
const paper = env.TRADING_MODE === "paper" ? new PaperExecutor(positions, pnl) : undefined;
const ocoManager = new OcoManager(orderStore, rest, env.TRADING_MODE, paper);
const orderManager = new OrderManager(rest, orderStore, env.TRADING_MODE, paper);

let bootstrapped = false;
let lastClosed1m = 0;
let running = false;
let cachedBalance: number | undefined;
let cachedProduct: any;
let wsSymbol: string | undefined;

process.on("SIGINT", () => {
  KillSwitch.trigger(KillReason.MANUAL);
});

let ws: DeltaWsClient | undefined;
let livePosition: any | undefined;

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
  let symbol = env.DELTA_PRODUCT_SYMBOL;
  let productId = env.DELTA_PRODUCT_ID;

  if (!symbol && productId) {
    try {
      const res = await rest.getProducts({
        contract_types: "perpetual_futures",
        states: "live",
      });
      const match = res.result.find(
        (p: { symbol?: string; id?: number | string; product_id?: number | string }) => {
          const rawId = p.id ?? p.product_id;
          const id = typeof rawId === "string" ? Number(rawId) : rawId;
          return Number.isFinite(id) && Number(id) === productId;
        }
      );
      if (match?.symbol) {
        symbol = match.symbol;
        cachedProduct = match;
      }
    } catch (error) {
      console.error(
        `[ARES.MARKET] Failed to resolve product symbol for id ${productId}:`,
        error
      );
    }
  }

  if (!symbol) {
    symbol = defaultSymbol;
  }

  wsSymbol = symbol;

  if (!productId) {
    productId = await resolveProductIdBySymbol(rest, symbol);
  }

  console.log(`[ARES.MARKET] Using product ${symbol} (id: ${productId ?? "unknown"})`);

  if (!cachedProduct) {
    try {
      const res = await rest.getProductBySymbol(symbol);
      cachedProduct = res?.result;
    } catch (error) {
      console.warn(`[ARES.MARKET] Failed to load product metadata for ${symbol}:`, error);
    }
  }

  await bootstrapMarket(rest, market, symbol);
  bootstrapped = true;

  ws = new DeltaWsClient(
    (msg: TickerMessage) => {
      const msgType = msg.type;
      const isTicker = msgType === "ticker" || msgType === "v2/ticker";
      if (msgType === "orders") {
        handleOrderUpdate(msg);
        return;
      }
      if (msgType === "positions") {
        handlePositionUpdate(msg);
        return;
      }
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
      if (paper) {
        paper.onTick(price);
      }
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
    },
    {
      auth: env.TRADING_MODE === "live",
      onAuth: (success) => {
        if (!success) {
          console.warn("[ARES.MARKET] WS auth failed; private channels disabled");
          return;
        }
        console.info("[ARES.MARKET] WS auth OK; subscribing to orders/positions");
        ws?.subscribe("orders", ["all"]);
        ws?.subscribe("positions", ["all"]);
      },
    }
  );

  if (paper) {
    const handleUpdate = (orderId: string, status: string) => {
      orderManager.onPaperOrderUpdate(orderId, status);
      void ocoManager.onOrderUpdate(orderId, status);
      if (!positions.isOpen) {
        console.info(`[ARES.PAPER] Realized PnL=${pnl.value.toFixed(2)}`);
      }
    };
    paper.setOnOrderUpdate(handleUpdate);
  }

  ws.connect();
}

bootstrap().catch((e) => {
  console.error("BOOT FAILURE", e);
  process.exit(1);
});

function matchWsSymbol(symbol?: string) {
  if (!symbol || !wsSymbol) return true;
  return symbol.toUpperCase() === wsSymbol.toUpperCase();
}

function normalizeOrderUpdates(msg: any): any[] {
  if (Array.isArray(msg?.result)) return msg.result;
  if (Array.isArray(msg?.orders)) return msg.orders;
  return [msg];
}

function resolveOrderStatus(order: any): string | undefined {
  const state = order?.state ?? order?.order_state;
  if (typeof state === "string") {
    if (state === "filled") return "closed";
    return state;
  }
  if (order?.action === "delete") return "closed";
  if (order?.reason === "fill" && order?.unfilled_size === 0) return "closed";
  if (order?.unfilled_size === 0 && order?.filled_size != null) return "closed";
  return undefined;
}

function handleOrderUpdate(msg: any) {
  const updates = normalizeOrderUpdates(msg);
  for (const order of updates) {
    const symbol = order?.product_symbol ?? order?.symbol;
    if (!matchWsSymbol(symbol)) continue;
    const orderId = order?.id ?? order?.order_id;
    if (orderId == null) continue;
    const status = resolveOrderStatus(order);
    if (status === "closed") {
      void ocoManager.onOrderUpdate(String(orderId), status);
    }
  }
}

function normalizePositions(msg: any): any[] {
  if (Array.isArray(msg?.result)) return msg.result;
  if (Array.isArray(msg?.positions)) return msg.positions;
  return [msg];
}

function handlePositionUpdate(msg: any) {
  const updates = normalizePositions(msg);
  for (const pos of updates) {
    const symbol = pos?.product_symbol ?? pos?.symbol;
    if (!matchWsSymbol(symbol)) continue;
    livePosition = pos;
    const size = Number(pos?.size ?? 0);
    if (!Number.isFinite(size)) continue;
    const entry = pos?.entry_price ?? pos?.avg_price ?? pos?.mark_price;
    console.info(
      `[ARES.MARKET] Position update ${symbol} size=${size} entry=${entry ?? "?"}`
    );
  }
}

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
  let balance =
    env.TRADING_MODE === "paper"
      ? env.PAPER_BALANCE ?? cachedBalance ?? 0
      : cachedBalance ?? 0;
  if (env.TRADING_MODE === "paper" && env.PAPER_BALANCE == null) {
    console.warn("[ARES.RISK] PAPER_BALANCE not set; using cached/zero balance");
  }
  if (env.TRADING_MODE !== "paper") {
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
      symbol: env.DELTA_PRODUCT_SYMBOL ?? SYMBOLS.BTC_USDT.symbol,
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
