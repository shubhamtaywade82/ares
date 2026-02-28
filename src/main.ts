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
  lastClosed1m: number;
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
const orderManager = new OrderManager(rest, orderStore, env.TRADING_MODE, paper);

const symbolContexts = new Map<string, SymbolContext>();
const livePositions = new Map<string, any>();

let cachedBalance: number | undefined;
let lastPaperLogAt = 0;
let ws: DeltaWsClient | undefined;

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

  const symbols = normalizeSymbols();
  if (symbols.length === 0) {
    throw new Error("No symbols configured for trading");
  }

  for (const symbol of symbols) {
    let productId = env.DELTA_PRODUCT_ID;
    if (env.DELTA_PRODUCT_SYMBOL && env.DELTA_PRODUCT_SYMBOL !== symbol) {
      productId = undefined;
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
      lastClosed1m: 0,
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
      if (paper) {
        paper.onTick(price, ctx.productId, ctx.symbol);
        logPaperPosition(ctx, price);
      }

      const closed = ctx.market.lastClosed("1m");
      if (!closed || closed.timestamp === ctx.lastClosed1m) return;
      ctx.lastClosed1m = closed.timestamp;
      void onNew1mClose(ctx);
    },
    () => {
      logger.error("KILL SWITCH TRIGGERED");
      process.exit(1);
    },
    () => {
      const symbolsForWs = Array.from(symbolContexts.keys());
      logger.info(
        `[ARES.MARKET] WS connected; subscribing to ticker (${symbolsForWs.join(",")})`
      );
      ws?.subscribe("v2/ticker", symbolsForWs);
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
    dailyPnl: env.TRADING_MODE === "paper" ? pnl.value : 0,
    openTrades,
    openTradesBySymbol,
  };
}

async function onNew1mClose(ctx: SymbolContext) {
  if (ctx.running) return;
  ctx.running = true;
  try {
    await Promise.all([ctx.indicators.update("5m"), ctx.indicators.update("15m")]);

    ctx.structure.update(ctx.market.candles("15m"));
    ctx.smc.update(ctx.market.candles("15m"), ctx.structure.lastBreaks);

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
      }
      return; // Skip setup detection if position is active
    }

    const signal = await runStrategy(ctx.market, ctx.indicators, ctx.structure, ctx.smc);
    if (!signal) return;

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

    const entryPrice = last5m.close;
    const stopPrice =
      signal.side === "LONG" ? entryPrice - ind5m.atr14 : entryPrice + ind5m.atr14;
    const targetPrice = computeTargets(
      entryPrice,
      stopPrice,
      signal.side,
      RISK_CONFIG.minRR
    );

    const minLotSize = resolveMinLotSize(ctx.cachedProduct);

    const ctxRisk = await getRiskContext(ctx.symbol);
    if (ctxRisk.equity <= 0) {
      logger.warn("[ARES.RISK] Equity unavailable or zero; blocking execution");
      return;
    }

    const contractValue = Number(ctx.cachedProduct?.contract_value ?? 1);
    const inrToUsd = 1 / RISK_CONFIG.USDINR;

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
    const ind15m = ctx.indicators.snapshot("15m");
    const aiInput = {
      symbol: ctx.symbol,
      side: signal.side,
      timeframeBias: {
        htf: bias === "LONG" ? "BULL" : bias === "SHORT" ? "BEAR" : "RANGE",
        rsi: ind15m.rsi14 ?? 50,
        emaSlope:
          ctx.market.candles("15m").length >= 2 &&
          ctx.market.candles("15m").at(-1)!.close >
            ctx.market.candles("15m").at(-2)!.close
            ? "UP"
            : ctx.market.candles("15m").length >= 2 &&
                ctx.market.candles("15m").at(-1)!.close <
                  ctx.market.candles("15m").at(-2)!.close
              ? "DOWN"
              : "FLAT",
      } as any, // Cast to any to bypass the htf type mismatch for now or fix types
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

    await orderManager.execute({
      symbol: ctx.symbol,
      ...(ctx.productId !== undefined ? { productId: ctx.productId } : {}),
      side: signal.side,
      entryPrice,
      stopPrice,
      targetPrice,
      qty: risk.qty,
      useMarketEntry: env.TRADING_MODE === "paper" && env.PAPER_MARKET_ENTRY,
    });
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
    if (symbol == null) continue;
    if (!symbolContexts.has(String(symbol).toUpperCase())) continue;
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
    if (symbol == null) continue;
    const key = String(symbol).toUpperCase();
    if (!symbolContexts.has(key)) continue;
    const size = Number(pos?.size ?? 0);
    if (Number.isFinite(size) && size !== 0) {
      livePositions.set(key, pos);
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
  logger.info(
    `[ARES.PAPER] Position ${ctx.symbol} ${pos.side} qty=${qty} entry=${entry.toFixed(
      2
    )} price=${price.toFixed(2)} ` +
      `pnl=${pnlINR.toFixed(2)} INR ` +
      `priceChange=${priceChangePct.toFixed(2)}% ` +
      `pnlPct=${pnlPct.toFixed(2)}%`
  );
}
