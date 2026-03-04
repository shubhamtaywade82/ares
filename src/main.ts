import "dotenv/config";
import { logger } from "./utils/logger.js";
import { DeltaRestClient } from "./delta/rest.client.js";
import { DeltaWsClient } from "./delta/ws.client.js";
import { MarketCache } from "./market/market.cache.js";
import { bootstrapMarket } from "./market/bootstrap.js";
import { env } from "./config/env.js";
import { KillSwitch } from "./risk/kill.switch.js";
import { KillReason } from "./risk/kill.reasons.js";
import { IndicatorCache } from "./indicators/indicator.cache.js";
import { runStrategy } from "./strategy/strategy.runner.js";
import { evaluateRisk } from "./risk/risk.evaluator.js";
import { RISK_CONFIG, resolveMaxLeverage } from "./config/risk.js";
import { computeHTFBias } from "./strategy/bias.htf.js";
import { computeTargets } from "./execution/sltp.manager.js";
import { createAIClientFromEnv } from "./ai/ai.client.js";
import { aiVeto } from "./ai/ai.veto.js";
import { AIVetoInput } from "./ai/ai.types.js";
import { OrderStore } from "./state/order.store.js";
import { OrderManager } from "./execution/order.manager.js";
import { RiskContext } from "./risk/types.js";
import { PaperExecutor } from "./execution/paper.executor.js";
import { PositionStore } from "./state/position.store.js";
import { PnlTracker } from "./state/pnl.tracker.js";
import { OcoManager } from "./execution/oco.manager.js";
import { StructureAnalyzer } from "./strategy/structure.js";
import { SmcAnalyzer } from "./strategy/smc.js";
import { savePaperState, loadPaperState } from "./state/persistence.js";
import { managePosition } from "./strategy/management.js";
import { BracketBuilder } from "./execution/bracket.builder.js";
import { ExitManager } from "./execution/exit.manager.js";
import { TradeJournal } from "./execution/trade.journal.js";
import { ActivePosition } from "./execution/trade.types.js";

type TickerMessage = {
  type?: string;
  price?: number | string;
  volume?: number | string;
  timestamp?: number;
  symbol?: string;
};

type SymbolContext = {
  symbol: string;
  productId?: number;
  market: MarketCache;
  indicators: IndicatorCache;
  lastClosed5m: number;
  running: boolean;
  cachedProduct?: any;
  structure: StructureAnalyzer;
  smc: SmcAnalyzer;
};

const rest = new DeltaRestClient();
const aiClient = createAIClientFromEnv();
const orderStore = new OrderStore();
const positions = new PositionStore();
const pnl = new PnlTracker();
const paper = env.TRADING_MODE === "paper" ? new PaperExecutor(positions, pnl) : undefined;
const ocoManager = new OcoManager(orderStore, rest, env.TRADING_MODE, paper);
const activePositions = new Map<string, ActivePosition>();
const bracketBuilder = new BracketBuilder(rest);
const tradeJournal = new TradeJournal();
const exitManager = new ExitManager(rest, bracketBuilder, tradeJournal, activePositions, {
  isDailyLossBreached: () => {
    const dailyPnl = env.TRADING_MODE === "paper" ? pnl.value - dailyPnlBaseline : 0;
    const eq = cachedBalance ?? 0;
    if (eq <= 0) return false;
    return dailyPnl < 0 && Math.abs(dailyPnl) / eq >= RISK_CONFIG.maxDailyLossPct;
  },
  recordTrade: (tradePnl: number) => pnl.record(tradePnl),
  activateKillSwitch: (reason: string) => KillSwitch.trigger(KillReason.MAX_DAILY_LOSS, { reason }),
});
const orderManager = new OrderManager(rest, orderStore, env.TRADING_MODE, paper, bracketBuilder, activePositions);

const symbolContexts = new Map<string, SymbolContext>();
const livePositions = new Map<string, any>();
type PendingLiveEntry = {
  placedAt: number;
  orderId?: string;
};

const pendingLiveEntries = new Map<string, PendingLiveEntry>();
const watchlistLtps = new Map<string, number>();

let cachedBalance: number | undefined;
let lastPaperLogAt = 0;
let lastWatchlistLtpLogAt = 0;
let dailyPnlBaseline = 0;
let dailyPnlResetTimer: NodeJS.Timeout | undefined;
let ws: DeltaWsClient | undefined;
let wsConnectedOnce = false;
let pendingExpiryTimer: NodeJS.Timeout | undefined;

const PENDING_ENTRY_TIMEOUT_MS = 15 * 60 * 1000;


function scheduleDailyPnlReset() {
  if (env.TRADING_MODE !== "paper") return;

  if (dailyPnlResetTimer) {
    clearTimeout(dailyPnlResetTimer);
    dailyPnlResetTimer = undefined;
  }

  const now = new Date();
  const nowInIST = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const nextMidnightInIST = new Date(nowInIST);
  nextMidnightInIST.setHours(24, 0, 0, 0);
  const delayMs = Math.max(1_000, nextMidnightInIST.getTime() - nowInIST.getTime());

  dailyPnlResetTimer = setTimeout(() => {
    dailyPnlBaseline = pnl.value;
    logger.info(
      `[ARES.RISK] Daily PnL baseline reset at IST midnight: baseline=${dailyPnlBaseline.toFixed(2)} INR`
    );
    scheduleDailyPnlReset();
  }, delayMs);
}

async function performEmergencyFlatten(reason: KillReason) {
  logger.error(`[ARES.KILL] Emergency flatten start: ${reason}`);
  try {
    await rest.cancelAllOrders();
    logger.error("[ARES.KILL] cancelAllOrders completed");
  } catch (error) {
    logger.error(error, "[ARES.KILL] cancelAllOrders failed:");
  }

  try {
    await rest.closeAllPositions();
    logger.error("[ARES.KILL] closeAllPositions completed");
  } catch (error) {
    logger.error(error, "[ARES.KILL] closeAllPositions failed:");
  }

  if (pendingExpiryTimer) clearInterval(pendingExpiryTimer);
  if (dailyPnlResetTimer) clearTimeout(dailyPnlResetTimer);
}

KillSwitch.setCleanup(async (reason) => {
  await performEmergencyFlatten(reason);
});

function setPendingLiveEntry(symbol: string, orderId?: string, placedAt?: number) {
  const key = symbol.toUpperCase();
  const prev = pendingLiveEntries.get(key);
  pendingLiveEntries.set(key, {
    placedAt: prev?.placedAt ?? placedAt ?? Date.now(),
    ...(orderId ? { orderId } : {}),
  });
}

async function expireStalePendingEntries() {
  const now = Date.now();
  for (const [symbol, pending] of pendingLiveEntries.entries()) {
    if (now - pending.placedAt <= PENDING_ENTRY_TIMEOUT_MS) continue;

    if (pending.orderId) {
      try {
        await rest.cancelOrder(pending.orderId);
        logger.warn(
          `[ARES.EXECUTION] Pending entry timeout for ${symbol}; cancelled order ${pending.orderId}`
        );
        pendingLiveEntries.delete(symbol);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const lower = message.toLowerCase();

        if (
          lower.includes("order_not_found") ||
          lower.includes("already filled") ||
          lower.includes("404") ||
          lower.includes("closed") ||
          lower.includes("cancelled")
        ) {
          logger.warn(
            `[ARES.EXECUTION] Pending entry timeout for ${symbol}; order already resolved (${pending.orderId})`
          );
          pendingLiveEntries.delete(symbol);
          continue;
        }

        logger.warn(
          `[ARES.EXECUTION] Pending entry timeout for ${symbol}; cancel failed for ${pending.orderId}, retaining pending state`
        );
        logger.warn(error, `[ARES.EXECUTION] Cancel error details for ${symbol}:`);
        continue;
      }
      continue;
    }

    logger.warn(`[ARES.EXECUTION] Pending entry timeout for ${symbol}; clearing without order id`);
    pendingLiveEntries.delete(symbol);
  }
}

async function persistState() {
  if (env.TRADING_MODE !== "paper") return;
  await savePaperState({
    realizedPnl: pnl.value,
    positions: positions.all(),
  });
}

process.on("SIGINT", async () => {
  await persistState();
  KillSwitch.trigger(KillReason.MANUAL);
});

process.on("SIGTERM", async () => {
  await persistState();
  KillSwitch.trigger(KillReason.MANUAL);
});

process.on("SIGUSR1", async () => {
  await persistState();
  KillSwitch.trigger(KillReason.MANUAL);
});

function normalizeSymbols(): string[] {
  const rawList = env.DELTA_PRODUCT_SYMBOLS;
  if (rawList) {
    return rawList
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => s.toUpperCase());
  }
  if (env.DELTA_PRODUCT_SYMBOL) {
    return [env.DELTA_PRODUCT_SYMBOL.toUpperCase()];
  }
  return ["BTCUSD", "ETHUSD", "XRPUSD", "SOLUSD"];
}

function logWatchlistLtps(nowMs: number) {
  if (nowMs - lastWatchlistLtpLogAt < 5_000) return;
  lastWatchlistLtpLogAt = nowMs;

  const snapshot = Array.from(symbolContexts.keys())
    .map((symbol) => {
      const ltp = watchlistLtps.get(symbol);
      if (!Number.isFinite(ltp)) return `${symbol}=NA`;
      const precision = symbol === "XRPUSD" ? 4 : 2;
      return `${symbol}=${ltp!.toFixed(precision)}`;
    })
    .join(" | ");

  if (snapshot.length > 0) {
    logger.info(`[ARES.MARKET] Watchlist LTP ${snapshot}`);
  }
}

async function reconcileLivePositionsOnBoot() {
  if (env.TRADING_MODE !== "live") return;

  try {
    const res = await rest.getPositions();
    const positionsList = Array.isArray(res?.result) ? res.result : [];

    let openCount = 0;
    for (const pos of positionsList) {
      const symbol = pos?.product_symbol ?? pos?.symbol;
      if (symbol == null) continue;

      const size = Number(pos?.size ?? 0);
      if (!Number.isFinite(size) || size === 0) continue;

      const key = String(symbol).toUpperCase();
      if (!symbolContexts.has(key)) continue;

      livePositions.set(key, pos);
      openCount += 1;
      logger.warn(
        `[ARES.MARKET] Reconciled open live position on boot: ${key} size=${size}`
      );
    }

    let pendingCount = 0;
    try {
      const ordersRes = await rest.getOrders({ state: "open", page_size: 200 });
      const openOrders = Array.isArray(ordersRes?.result) ? ordersRes.result : [];

      for (const order of openOrders) {
        const symbol = order?.product_symbol ?? order?.symbol;
        const id = order?.id ?? order?.order_id;
        if (symbol == null || id == null) continue;

        const key = String(symbol).toUpperCase();
        if (!symbolContexts.has(key)) continue;

        const reduceOnly = Boolean(order?.reduce_only ?? order?.reduceOnly);
        if (reduceOnly) {
          logger.info(`[ARES.MARKET] Ignoring reduce-only open order on boot for ${key}: ${id}`);
          continue;
        }

        setPendingLiveEntry(key, String(id), Number(order?.created_at) || undefined);
        pendingCount += 1;
      }
    } catch (error) {
      logger.warn(error, "[ARES.MARKET] Failed to reconcile open orders on boot:");
    }

    if ((openCount > 0 || pendingCount > 0) && env.BOOT_BLOCK_ON_ORPHAN_POSITIONS) {
      logger.error(
        `[ARES.RISK] BOOT_BLOCK_ON_ORPHAN_POSITIONS enabled; triggering kill switch for ` +
          `${openCount} open position(s) and ${pendingCount} open order(s)`
      );
      KillSwitch.trigger(KillReason.STATE_INCONSISTENT);
    }
  } catch (error) {
    logger.warn(error, "[ARES.MARKET] Failed to reconcile positions on boot:");
  }
}

async function resolveProductIdBySymbol(restClient: DeltaRestClient, symbol: string) {
  try {
    const res = await restClient.getProductBySymbol(symbol);
    const rawId = res?.result?.id ?? res?.result?.product_id ?? res?.result?.productId;
    const id = typeof rawId === "string" ? Number(rawId) : rawId;
    if (Number.isFinite(id)) return Number(id);
  } catch (error) {
    logger.error(error, `[ARES.MARKET] Failed to resolve product id for ${symbol}:`);
  }

  try {
    const res = await restClient.getProducts({
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
    logger.error(
      error,
      `[ARES.MARKET] Failed to resolve product id from products list for ${symbol}:`
    );
  }

  return undefined;
}

async function verifyConfiguredProductId(restClient: DeltaRestClient, symbol: string, configuredProductId: number) {
  try {
    const res = await restClient.getProductBySymbol(symbol);
    const rawId = res?.result?.id ?? res?.result?.product_id ?? res?.result?.productId;
    const resolved = typeof rawId === "string" ? Number(rawId) : rawId;
    if (!Number.isFinite(resolved)) {
      throw new Error(`Could not resolve product id for ${symbol} from Delta product metadata`);
    }
    if (Number(resolved) !== configuredProductId) {
      throw new Error(
        `[ARES.MARKET] Product ID mismatch for ${symbol}: configured=${configuredProductId}, delta=${Number(resolved)}`
      );
    }
  } catch (error) {
    logger.error(error, `[ARES.MARKET] Product ID verification failed for ${symbol}:`);
    throw error;
  }
}

async function bootstrap() {
  if (env.TRADING_MODE === "paper") {
    const saved = await loadPaperState();
    if (saved) {
      pnl.hydrate(saved.realizedPnl);
      positions.hydrate(saved.positions);
      logger.info(
        `[ARES.BOOT] Restored paper state: PnL=${saved.realizedPnl.toFixed(2)} INR, Positions=${
          saved.positions.length
        }`
      );
    }
  }

  dailyPnlBaseline = pnl.value;
  scheduleDailyPnlReset();

  const symbols = normalizeSymbols();
  if (symbols.length === 0) {
    throw new Error("No symbols configured for trading");
  }

  for (const symbol of symbols) {
    let productId = env.DELTA_PRODUCT_ID;
    const useConfiguredProductId = Boolean(
      productId && (!env.DELTA_PRODUCT_SYMBOL || env.DELTA_PRODUCT_SYMBOL === symbol)
    );
    if (env.DELTA_PRODUCT_SYMBOL && env.DELTA_PRODUCT_SYMBOL !== symbol) {
      productId = undefined;
    }

    if (useConfiguredProductId && productId) {
      await verifyConfiguredProductId(rest, symbol, productId);
    }

    if (!productId) {
      productId = await resolveProductIdBySymbol(rest, symbol);
    }

    const market = new MarketCache();
    const indicators = new IndicatorCache(market);
    const context: SymbolContext = {
      symbol,
      market,
      indicators,
      structure: new StructureAnalyzer(),
      smc: new SmcAnalyzer(),
      lastClosed5m: 0,
      running: false,
      ...(productId !== undefined ? { productId } : {}),
    };


    if (productId !== undefined) {
      const collision = [...symbolContexts.values()].find(
        (c) => c.productId === productId && c.symbol !== symbol
      );
      if (collision) {
        logger.warn(
          `[ARES.MARKET] Product id collision: ${symbol} and ${collision.symbol} both resolved to id=${productId}. ` +
            `Using symbol-based keying for ${symbol}.`
        );
        delete context.productId;
      }
    }

    logger.info(`[ARES.MARKET] Using product ${symbol} (id: ${context.productId ?? "symbol-keyed"})`);

    try {
      const res = await rest.getProductBySymbol(symbol);
      context.cachedProduct = res?.result;
      if (paper && context.cachedProduct?.contract_value != null) {
        const raw = context.cachedProduct.contract_value;
        const contractValue = typeof raw === "string" ? Number(raw) : raw;
        if (Number.isFinite(contractValue) && contractValue > 0) {
          paper.setContractValue(productId, symbol, contractValue);
        }
      }
    } catch (error) {
      logger.warn(error, `[ARES.MARKET] Failed to load product metadata for ${symbol}:`);
    }

    await bootstrapMarket(rest, market, symbol);

    symbolContexts.set(symbol.toUpperCase(), context);
  }

  await reconcileLivePositionsOnBoot();

  if (env.TRADING_MODE === "live") {
    try {
      const [bootPosRes, bootOrdersRes] = await Promise.all([
        rest.getPositions(),
        rest.getOrders({ state: "open", page_size: 200 }),
      ]);
      const bootPositions = Array.isArray(bootPosRes?.result) ? bootPosRes.result : [];
      const bootOrders = Array.isArray(bootOrdersRes?.result) ? bootOrdersRes.result : [];
      await exitManager.reconcileOnBoot(
        bootPositions as Array<Record<string, unknown>>,
        bootOrders as Array<Record<string, unknown>>,
        env.BOOT_CLOSE_ORPHAN_POSITIONS,
        async (symbol: string) => {
          const open = bootPositions.find(
            (pos: Record<string, unknown>) =>
              String(pos.product_symbol ?? pos.symbol ?? "").toUpperCase() === symbol.toUpperCase()
          );
          const size = Number(open?.size ?? 0);
          if (!Number.isFinite(size) || size === 0) return;
          await rest.placeOrder({
            product_symbol: symbol,
            side: size > 0 ? "sell" : "buy",
            order_type: "market_order",
            size: Math.abs(size),
            reduce_only: true,
          });
        }
      );
    } catch (error) {
      logger.warn(error, "[ARES.MARKET] Boot reconcile (exit manager) failed:");
    }
  }

  ws = new DeltaWsClient(
    (msg: TickerMessage) => {
      const msgType = msg.type;
      if (msgType === "orders") {
        handleOrderUpdate(msg);
        return;
      }
      if (msgType === "positions") {
        handlePositionUpdate(msg);
        return;
      }

      const isTicker = msgType === "ticker" || msgType === "v2/ticker";
      if (!isTicker) return;

      const symbol =
        (msg as any).symbol ?? (msg as any).product_symbol ?? (msg as any).productSymbol;
      if (!symbol) return;
      const ctx = symbolContexts.get(String(symbol).toUpperCase());
      if (!ctx) return;

      const rawPrice =
        (msg as any).mark_price ??
        (msg as any).close ??
        (msg as any).spot_price ??
        msg.price;
      const price = Number(rawPrice);
      const volume = Number(msg.volume ?? 0);
      const rawTs = (msg as any).timestamp ?? (msg as any).ts ?? (msg as any).time;
      const parsedTs = Number(rawTs);

      if (!Number.isFinite(price) || !Number.isFinite(parsedTs)) {
        return;
      }

      const tsMs = parsedTs > 1e12 ? parsedTs / 1000 : parsedTs;
      ctx.market.ingestTick(price, volume, tsMs);
      watchlistLtps.set(ctx.symbol.toUpperCase(), price);
      logWatchlistLtps(Date.now());
      if (paper) {
        paper.onTick(price, ctx.productId, ctx.symbol);
        logPaperPosition(ctx, price);
      }

      const closed5m = ctx.market.lastClosed("5m");
      if (!closed5m || closed5m.timestamp === ctx.lastClosed5m) return;
      ctx.lastClosed5m = closed5m.timestamp;
      void onNew5mClose(ctx);
    },
    () => {
      logger.error("KILL SWITCH TRIGGERED");
      process.exit(1);
    },
    async () => {
      const symbolsForWs = Array.from(symbolContexts.keys());

      if (wsConnectedOnce) {
        logger.warn("[ARES.MARKET] WS reconnected; reseeding market caches before resubscribe");
        await Promise.all(
          Array.from(symbolContexts.values()).map((ctx) =>
            bootstrapMarket(rest, ctx.market, ctx.symbol)
          )
        );
      }

      logger.info(
        `[ARES.MARKET] WS connected; subscribing to ticker (${symbolsForWs.join(",")})`
      );
      ws?.subscribe("v2/ticker", symbolsForWs);
      wsConnectedOnce = true;
    },
    {
      auth: env.TRADING_MODE === "live",
      onAuth: (success) => {
        if (!success) {
          logger.warn("[ARES.MARKET] WS auth failed; private channels disabled");
          return;
        }
        logger.info("[ARES.MARKET] WS auth OK; subscribing to orders/positions");
        ws?.subscribe("orders", ["all"]);
        ws?.subscribe("positions", ["all"]);
      },
    }
  );

  if (paper) {
    paper.setOnStateChange(persistState);
    const handleUpdate = (orderId: string, status: string) => {
      orderManager.onPaperOrderUpdate(orderId, status);
      void ocoManager.onOrderUpdate(orderId, status);
      if (!positions.isOpen) {
        logger.info(`[ARES.PAPER] Realized PnL=${pnl.value.toFixed(2)} INR`);
      }
    };
    paper.setOnOrderUpdate(handleUpdate);
  }

  if (env.TRADING_MODE === "live") {
    pendingExpiryTimer = setInterval(() => {
      void expireStalePendingEntries();
    }, 60_000);
  }

  ws.connect();
}

bootstrap().catch((e) => {
  logger.error("BOOT FAILURE", e);
  process.exit(1);
});

// Delta Exchange perpetuals trade in whole contracts; minimum order is 1 contract.
// `contract_value` tells you the underlying per contract (e.g. 0.001 BTC for BTCUSD)
// but the minimum *lot* is always 1 integer contract.
function resolveMinLotSize(_product: any): number {
  return 1;
}

function resolveSession(): "ASIA" | "EU" | "US" {
  const hour = new Date().getUTCHours();
  if (hour >= 0 && hour < 7) return "ASIA";
  if (hour >= 7 && hour < 13) return "EU";
  return "US";
}

function countOpenTradesBySymbol(symbol: string): number {
  const key = symbol.toUpperCase();
  if (env.TRADING_MODE === "paper") {
    return positions.all().filter((pos) => pos.productSymbol?.toUpperCase() === key).length;
  }
  const pos = livePositions.get(key);
  const size = Number(pos?.size ?? 0);
  return Number.isFinite(size) && size !== 0 ? 1 : 0;
}

async function getRiskContext(symbol: string): Promise<RiskContext> {
  let balance =
    env.TRADING_MODE === "paper"
      ? env.PAPER_BALANCE ?? cachedBalance ?? 0
      : cachedBalance ?? 0;
  if (env.TRADING_MODE === "paper" && env.PAPER_BALANCE == null) {
    logger.warn("[ARES.RISK] PAPER_BALANCE not set; using cached/zero balance");
  }
  if (env.TRADING_MODE !== "paper") {
    try {
      const res = await rest.getBalances();
      const balances = Array.isArray(res?.result) ? res.result : [];
      const preferred =
        balances.find((b: any) => b.asset_symbol === "USD") ??
        balances.find((b: any) => b.asset_symbol === "USDT") ??
        balances[0];
      const raw = preferred?.available_balance ?? preferred?.balance;
      const parsed = typeof raw === "string" ? Number(raw) : raw;
      if (Number.isFinite(parsed)) {
        balance = Number(parsed);
        cachedBalance = balance;
      }
    } catch (error) {
      logger.warn("[ARES.RISK] Failed to fetch balances, using cached value");
    }
  }

  let equity = balance;
  let availableBalance = balance;

  if (env.TRADING_MODE === "paper") {
    // equity = initial + realized pnl/fees
    equity = balance + pnl.value;

    let usedMargin = 0;
    for (const pos of positions.all()) {
      const contractValue = Number(pos.cachedProduct?.contract_value ?? 1);
      const leverage = paper?.getOrderLeverage(pos.productId, pos.productSymbol).leverage ?? 1;
      const notionalUSD = pos.qty * pos.entryPrice * contractValue;
      const marginUSD = Math.abs(notionalUSD) / leverage;
      usedMargin += marginUSD * RISK_CONFIG.USDINR;
    }
    availableBalance = equity - usedMargin;
  }

  const openTradesBySymbol: Record<string, number> = {};
  for (const key of symbolContexts.keys()) {
    openTradesBySymbol[key] = countOpenTradesBySymbol(key);
  }
  const openTrades = Object.values(openTradesBySymbol).reduce((sum, val) => sum + val, 0);

  return {
    equity,
    availableBalance,
    dailyPnl: env.TRADING_MODE === "paper" ? pnl.value - dailyPnlBaseline : 0,
    openTrades,
    openTradesBySymbol,
  };
}

function prepareAIInput(
  ctx: SymbolContext,
  intent: "ENTRY" | "EXIT",
  price: number,
  side: "LONG" | "SHORT",
  score?: number,
  reasons?: string[]
): AIVetoInput {
  const ind15m = ctx.indicators.snapshot("15m");
  const ind5m = ctx.indicators.snapshot("5m");

  const htf: AIVetoInput["timeframeBias"]["htf"] =
    ctx.structure.lastBias === "BULLISH"
      ? "BULL"
      : ctx.structure.lastBias === "BEARISH"
        ? "BEAR"
        : "RANGE";

  const emaSlope: AIVetoInput["timeframeBias"]["emaSlope"] =
    ctx.market.candles("15m").length >= 2 &&
    ctx.market.candles("15m").at(-1)!.close > ctx.market.candles("15m").at(-2)!.close
      ? "UP"
      : ctx.market.candles("15m").length >= 2 &&
          ctx.market.candles("15m").at(-1)!.close < ctx.market.candles("15m").at(-2)!.close
        ? "DOWN"
        : "FLAT";

  const activeSweepMetrics = ctx.smc.activeSweepMetrics();
  const nearestBullishOb = ctx.smc.nearestOB(price, "BULLISH");
  const nearestBearishOb = ctx.smc.nearestOB(price, "BEARISH");
  const nearestBullishFvg = ctx.smc.nearestFVG(price, "BULLISH");
  const nearestBearishFvg = ctx.smc.nearestFVG(price, "BEARISH");

  return {
    intent,
    symbol: ctx.symbol,
    lastPrice: price,
    side,
    timeframeBias: {
      htf,
      rsi: ind15m.rsi14 ?? 50,
      emaSlope,
    },
    setupQuality: score != null ? { score, reasons: reasons ?? [] } : undefined,
    volatility: {
      atr: ind15m.atr14 ?? ind5m.atr14 ?? 0,
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
        ...(ctx.smc.activeSweep?.type ? { activeSweep: ctx.smc.activeSweep.type } : {}),
        ...(activeSweepMetrics
          ? {
              activeSweepAgeMinutes: activeSweepMetrics.ageMinutes,
              activeSweepVolumeRatio: activeSweepMetrics.volumeRatio,
            }
          : {}),
        ...(nearestBullishOb ? { nearestBullishOb } : {}),
        ...(nearestBearishOb ? { nearestBearishOb } : {}),
        ...(nearestBullishFvg ? { nearestBullishFvg } : {}),
        ...(nearestBearishFvg ? { nearestBearishFvg } : {}),
      },
    },
  };
}


async function onNew5mClose(ctx: SymbolContext) {
  if (ctx.running) return;
  ctx.running = true;
  try {
    if (env.TRADING_MODE === "live") {
      await expireStalePendingEntries();
    }

    await Promise.all([ctx.indicators.update("5m"), ctx.indicators.update("15m")]);

    const candles15m = ctx.market.candles("15m");
    const closed15m = candles15m.slice(0, -1);
    ctx.structure.update(closed15m);
    ctx.smc.update(closed15m, ctx.structure.lastBreaks, ctx.structure.lastSwings, true);

    // --- Active Position Management ---
    const activePos = positions.getByProduct(ctx.productId, ctx.symbol);
    const last1m = ctx.market.lastClosed("1m");
    if (activePos && last1m) {
      const action = managePosition(activePos, last1m.close, ctx.structure);
      if (action) {
        if (action.type === "CLOSE") {
          logger.info(`[ARES.MANAGEMENT] Closing ${ctx.symbol}: ${action.reason}`);
          if (env.TRADING_MODE === "paper" && paper) {
            paper.closePosition(ctx.productId, ctx.symbol, last1m.close);
          }
          // Live trade exit logic could go here
          return;
        } else if (action.type === "UPDATE_SL" && action.newStop != null) {
          logger.info(
            `[ARES.MANAGEMENT] Updating SL for ${ctx.symbol} to ${action.newStop}: ${action.reason}`
          );
          if (env.TRADING_MODE === "paper" && paper) {
            paper.updateStopLoss(ctx.productId, ctx.symbol, action.newStop);
          }
          // Live SL update logic could go here
        }
      } else {
        // AI Exit Advice
        const aiExitInput = prepareAIInput(
          ctx,
          "EXIT",
          last1m.close,
          activePos.side,
          undefined,
          undefined
        );

        try {
          const ai = await aiVeto(aiClient, aiExitInput);
          if (!ai.allowed) {
            logger.info(`[ARES.MANAGEMENT] AI Exit advice for ${ctx.symbol}: ${ai.reason}`);
            if (env.TRADING_MODE === "paper" && paper) {
              paper.closePosition(ctx.productId, ctx.symbol, last1m.close);
            }
            // Live exit logic would go here
            return;
          }
        } catch (error) {
          logger.debug(`[ARES.MANAGEMENT] AI exit check skipped: ${String(error)}`);
        }
      }
      return; // Skip setup detection if position is active
    }

    if (
      env.TRADING_MODE === "live" &&
      (countOpenTradesBySymbol(ctx.symbol) > 0 || pendingLiveEntries.has(ctx.symbol.toUpperCase()))
    ) {
      logger.info(`[ARES.STRATEGY] Skipping ${ctx.symbol}: live position already open/pending`);
      return;
    }

    const signal = await runStrategy(ctx.market, ctx.indicators, ctx.structure, ctx.smc);
    if (!signal) return;

    if (!exitManager.canReenter(ctx.symbol)) {
      exitManager.clearReentryBlock(ctx.symbol);
    }

    const last5m = ctx.market.lastClosed("5m");
    if (!last5m) {
      logger.warn("[ARES.STRATEGY] Missing 5m close for execution");
      return;
    }

    const ind5m = ctx.indicators.snapshot("5m");
    if (!ind5m.atr14) {
      logger.warn("[ARES.STRATEGY] Missing 5m ATR for execution");
      return;
    }

    const entryPrice = ctx.market.lastPrice();
    const stopPrice =
      signal.side === "LONG" ? entryPrice - ind5m.atr14 : entryPrice + ind5m.atr14;
    const targetPrice = computeTargets(
      entryPrice,
      stopPrice,
      signal.side,
      RISK_CONFIG.minRR
    );

    const minLotSize = resolveMinLotSize(ctx.cachedProduct);

    const leverage = resolveMaxLeverage(ctx.symbol);
    if (paper) {
      paper.setOrderLeverage(ctx.productId, ctx.symbol, leverage);
    }

    const ctxRisk = await getRiskContext(ctx.symbol);
    if (ctxRisk.equity <= 0) {
      logger.warn("[ARES.RISK] Equity unavailable or zero; blocking execution");
      return;
    }

    const contractValue = Number(ctx.cachedProduct?.contract_value ?? 1);
    const inrToUsd = 1 / RISK_CONFIG.USDINR;
    const requiredMarginInr =
      minLotSize * entryPrice * contractValue * RISK_CONFIG.USDINR / Math.max(1, leverage);
    if (requiredMarginInr > ctxRisk.availableBalance * 0.9) {
      logger.warn(
        `[ARES.RISK] Margin check failed for ${ctx.symbol}: required=${requiredMarginInr.toFixed(2)} available=${ctxRisk.availableBalance.toFixed(2)}`
      );
      if (env.TRADING_MODE !== "paper") return;
    }

    const risk = evaluateRisk(ctxRisk, {
      symbol: ctx.symbol,
      entryPrice,
      stopPrice,
      side: signal.side,
      minLotSize,
      contractValue,
      inrToUsd,
    });
    if (!risk.allowed) return;

    const bias = computeHTFBias(ctx.market, ctx.indicators);
    const aiInput = prepareAIInput(
      ctx,
      "ENTRY",
      entryPrice,
      signal.side,
      signal.score,
      signal.reasons
    );

    let aiAllowed = true;
    const aiHealthy = await aiClient.healthCheck(1500);
    if (!aiHealthy) {
      logger.warn("[ARES.RISK] AI veto unreachable; skipping in paper mode");
      if (env.TRADING_MODE !== "paper") {
        logger.warn("[ARES.RISK] AI veto unreachable; blocking live trade");
        return;
      }
    } else {
      try {
        const ai = await aiVeto(aiClient, aiInput);
        aiAllowed = ai.allowed;
      } catch (error) {
        if (env.TRADING_MODE === "paper") {
          logger.warn("[ARES.RISK] AI veto error in paper mode; proceeding without veto");
          aiAllowed = true;
        } else {
          logger.warn("[ARES.RISK] AI veto failed; blocking live trade");
          return;
        }
      }
      if (!aiAllowed) {
        if (env.TRADING_MODE === "paper") {
          logger.warn(`[ARES.RISK] AI veto BLOCK in paper mode — proceeding anyway for paper run`);
        } else {
          return;
        }
      }
    }

    if (env.TRADING_MODE === "live") {
      setPendingLiveEntry(ctx.symbol);
    }

    const executionSet = await orderManager.execute({
      symbol: ctx.symbol,
      ...(ctx.productId !== undefined ? { productId: ctx.productId } : {}),
      side: signal.side,
      entryPrice,
      stopPrice,
      targetPrice,
      qty: risk.qty,
      useMarketEntry: env.TRADING_MODE === "paper" && env.PAPER_MARKET_ENTRY,
      signalContext: {
        htfBias: bias,
        smcScore: signal.score,
        rr: RISK_CONFIG.minRR,
        reason: signal.reasons.join(" | "),
      },
    });

    if (env.TRADING_MODE === "live") {
      if (executionSet.entryOrderId) {
        setPendingLiveEntry(ctx.symbol, executionSet.entryOrderId);
      } else {
        pendingLiveEntries.delete(ctx.symbol.toUpperCase());
      }
    }
  } catch (error) {
    logger.error(error, "[ARES.STRATEGY] Cycle failure");
  } finally {
    ctx.running = false;
  }
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
    if (state === "partially_filled") return "partial";
    return state;
  }
  if (order?.action === "delete") return "closed";

  const unfilled = Number(order?.unfilled_size);
  const filled = Number(order?.filled_size);
  if (Number.isFinite(unfilled) && Number.isFinite(filled) && filled > 0 && unfilled > 0) {
    return "partial";
  }

  if (order?.reason === "fill" && order?.unfilled_size === 0) return "closed";
  if (order?.unfilled_size === 0 && order?.filled_size != null) return "closed";
  return undefined;
}

function handleOrderUpdate(msg: any) {
  logger.debug(`[ARES.WS.RAW] order_update ${JSON.stringify(msg)}`);
  const updates = normalizeOrderUpdates(msg);
  for (const order of updates) {
    const symbol = order?.product_symbol ?? order?.symbol;
    if (symbol == null) continue;
    if (!symbolContexts.has(String(symbol).toUpperCase())) continue;
    const orderId = order?.id ?? order?.order_id;
    if (orderId == null) continue;
    const status = resolveOrderStatus(order);
    if (status === "closed") {
      const filled = Number(order?.filled_size ?? order?.filled_qty ?? 0);
      if (Number.isFinite(filled) && filled > 0) {
        const normalizedOrderId = String(orderId);
        const avg = Number(order?.average_fill_price ?? order?.avg_fill_price ?? order?.limit_price ?? 0);
        const fillPrice = Number.isFinite(avg) ? avg : Number(order?.limit_price ?? 0);
        const isBracketOrder = exitManager.isBracketOrder(normalizedOrderId);
        const isPendingEntry = pendingLiveEntries.has(String(symbol).toUpperCase());

        if (isPendingEntry && !isBracketOrder) {
          void orderManager.onLiveEntryFilled(normalizedOrderId, filled, Number.isFinite(avg) ? avg : undefined);
        } else if (isBracketOrder && Number.isFinite(fillPrice) && fillPrice > 0) {
          void exitManager.onBracketFill(normalizedOrderId, filled, fillPrice);
        } else {
          logger.warn(`[ARES.EXECUTION] Unrouted fill update ignored for ${symbol} order:${normalizedOrderId}`);
        }
      }
      void ocoManager.onOrderUpdate(String(orderId), status);
      pendingLiveEntries.delete(String(symbol).toUpperCase());
      continue;
    }

    if (status === "partial") {
      const filled = Number(order?.filled_size ?? order?.filled_qty ?? 0);
      logger.warn(
        `[ARES.EXECUTION] Partial fill detected for ${symbol}: filled=${filled}. Rebalancing brackets to filled quantity.`
      );
      if (Number.isFinite(filled) && filled > 0) {
        void orderManager.onLiveEntryPartialFill(String(orderId), filled);
      }
      continue;
    }

    if (status === "cancelled" || status === "rejected") {
      pendingLiveEntries.delete(String(symbol).toUpperCase());
    }
  }
}

function normalizePositions(msg: any): any[] {
  if (Array.isArray(msg?.result)) return msg.result;
  if (Array.isArray(msg?.positions)) return msg.positions;
  return [msg];
}

function handlePositionUpdate(msg: any) {
  logger.debug(`[ARES.WS.RAW] position_update ${JSON.stringify(msg)}`);
  const updates = normalizePositions(msg);
  for (const pos of updates) {
    const symbol = pos?.product_symbol ?? pos?.symbol;
    if (symbol == null) continue;
    const key = String(symbol).toUpperCase();
    if (!symbolContexts.has(key)) continue;
    const size = Number(pos?.size ?? 0);
    if (Number.isFinite(size) && size !== 0) {
      livePositions.set(key, pos);
      pendingLiveEntries.delete(key);
    } else {
      livePositions.delete(key);
    }
    const entry = pos?.entry_price ?? pos?.avg_price ?? pos?.mark_price;
    logger.info(
      `[ARES.MARKET] Position update ${symbol} size=${size} entry=${entry ?? "?"}`
    );
  }
}

function logPaperPosition(ctx: SymbolContext, price: number) {
  if (env.TRADING_MODE !== "paper") return;
  if (!positions.isOpen) return;
  const now = Date.now();
  if (now - lastPaperLogAt < 1000) return;
  lastPaperLogAt = now;

  const pos = positions.getByProduct(ctx.productId, ctx.symbol);
  if (!pos) return;
  const qty = pos.qty;
  const entry = pos.entryPrice;
  const contractValueRaw = ctx.cachedProduct?.contract_value;
  const contractValue =
    typeof contractValueRaw === "string"
      ? Number(contractValueRaw)
      : typeof contractValueRaw === "number"
        ? contractValueRaw
        : 1;
  const currency =
    typeof ctx.cachedProduct?.settling_asset?.symbol === "string"
      ? ctx.cachedProduct.settling_asset.symbol
      : "QUOTE";
  const pnl =
    pos.side === "LONG"
      ? (price - entry) * qty * contractValue
      : (entry - price) * qty * contractValue;
  const maxLev = resolveMaxLeverage(ctx.symbol);
  const margin = (entry * qty * contractValue) / maxLev;
  const pnlPct = margin > 0 ? (pnl / margin) * 100 : 0;
  const priceChangePct = entry > 0 ? ((price - entry) / entry) * 100 : 0;

  const pnlINR = pnl * RISK_CONFIG.USDINR;
  const assetQty = qty * contractValue;
  const precision = ctx.symbol === "XRPUSD" ? 4 : 2;
  logger.info(
    `[ARES.PAPER] Position ${ctx.symbol} ${pos.side} qty=${qty} (${assetQty.toFixed(6)} ${currency}) entry=${entry.toFixed(
      precision
    )} price=${price.toFixed(precision)} ` +
      `pnl=${pnlINR.toFixed(2)} INR ` +
      `priceChange=${priceChangePct.toFixed(2)}% ` +
      `pnlPct=${pnlPct.toFixed(2)}%`
  );
}
