import "dotenv/config";
import http from "http";
import { WebSocketServer } from "ws";
import { logger } from "./utils/logger.js";
import { ARESStateMachine } from "./state/machine.js";
import {
  SystemState,
  RiskState,
  MarketRegime,
  StructureState,
  SignalState,
  PositionState,
  AresSnapshot
} from "./types/ares.state.js";
import { DeltaRestClient } from "./delta/rest.client.js";
import { DeltaWsClient } from "./delta/ws.client.js";
import { MarketCache } from "./market/market.cache.js";
import { bootstrapMarket } from "./market/bootstrap.js";
import { env } from "./config/env.js";
import { KillSwitch } from "./risk/kill.switch.js";
import { KillReason } from "./risk/kill.reasons.js";
import { IndicatorCache } from "./indicators/indicator.cache.js";
import { runStrategy } from "./strategy/strategy.runner.js";
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
import { BracketBuilder } from "./execution/bracket.builder.js";
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
  lastClosed15m: number;
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
const fsm = new ARESStateMachine();
const paper = env.TRADING_MODE === "paper" ? new PaperExecutor(positions, pnl) : undefined;
const ocoManager = new OcoManager(orderStore, rest, env.TRADING_MODE, paper);
const activePositions = new Map<string, ActivePosition>();
const bracketBuilder = new BracketBuilder(rest);
const tradeJournal = new TradeJournal();
const orderManager = new OrderManager(rest, orderStore, env.TRADING_MODE, paper, bracketBuilder, activePositions);

const symbolContexts = new Map<string, SymbolContext>();
const livePositions = new Map<string, any>();
const watchlistLtps = new Map<string, number>();

let cachedBalance: number | undefined;
let dailyPnlBaseline = 0;

async function getRiskContext(symbol: string): Promise<RiskContext> {
  let balance =
    env.TRADING_MODE === "paper"
      ? env.PAPER_BALANCE ?? cachedBalance ?? 0
      : cachedBalance ?? 0;

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

  if (env.TRADING_MODE === "paper" && balance <= 0 && env.PAPER_BALANCE != null) {
      balance = env.PAPER_BALANCE;
      cachedBalance = balance;
  }

  let equity = balance;
  let availableBalance = balance;

  if (env.TRADING_MODE === "paper") {
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
    symbol,
    equity,
    availableBalance,
    openTrades,
    openTradesBySymbol,
    dailyPnl: env.TRADING_MODE === "paper" ? pnl.value - dailyPnlBaseline : 0,
    maxDailyLossPct: RISK_CONFIG.maxDailyLossPct,
    maxSymbolExposure: 1,
  };
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

const API_PORT = 3001;

async function getStatePayload(): Promise<object> {
  const riskCtx = await getRiskContext("BTCUSD");
  const snapshot = fsm.getSnapshot();
  return {
    ...snapshot,
    portfolio: {
      balance: riskCtx.equity,
      available: riskCtx.availableBalance,
      totalPnl: pnl.value,
      dailyPnl: riskCtx.dailyPnl,
      winRate: tradeJournal.stats.winRate,
    },
    activePositions: Array.from(activePositions.values()),
    history: tradeJournal.history.slice(-10),
  };
}

const stateServer = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/api/state") {
    try {
      const data = await getStatePayload();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (err) {
      logger.error(err, "[ARES.API] State request failed");
      res.writeHead(500);
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server: stateServer });

function normalizeSymbols(): string[] {
  const raw = env.DELTA_PRODUCT_SYMBOL;
  if (!raw) return ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"];
  return raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

async function resolveProductIdBySymbol(restClient: DeltaRestClient, symbol: string): Promise<number | undefined> {
  try {
    const res = await restClient.getProducts({
      symbol,
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
    logger.error(error, `[ARES.MARKET] Failed to resolve product id for ${symbol}:`);
  }
  return undefined;
}

async function persistState() {
    if (env.TRADING_MODE === "paper") {
      await savePaperState({ realizedPnl: pnl.value, positions: positions.all() });
    }
}

function scheduleDailyPnlReset() {
  const now = new Date();
  const nextReset = new Date(now);
  nextReset.setUTCHours(0, 0, 0, 0);
  if (nextReset <= now) nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  const diff = nextReset.getTime() - now.getTime();
  setTimeout(() => {
    logger.info("[ARES.RISK] Resetting daily PnL baseline");
    dailyPnlBaseline = pnl.value;
    scheduleDailyPnlReset();
  }, diff);
}

async function bootstrap() {
  stateServer.listen(API_PORT, "0.0.0.0", () => {
    logger.info(`[ARES.API] State server listening on 0.0.0.0:${API_PORT}`);
    setInterval(() => {
      getStatePayload()
        .then((data) => {
          const payload = JSON.stringify(data);
          for (const client of wss.clients) {
            if (client.readyState === 1) client.send(payload);
          }
        })
        .catch((err) => logger.error(err, "[ARES.API] WebSocket state broadcast failed"));
    }, 1000);
  });

  if (env.TRADING_MODE === "paper") {
    const saved = await loadPaperState();
    if (saved) {
      pnl.hydrate(saved.realizedPnl);
      positions.hydrate(saved.positions);
      logger.info(`[ARES.BOOT] Restored paper state: PnL=${saved.realizedPnl.toFixed(2)}, Pos=${saved.positions.length}`);
    }
  }

  dailyPnlBaseline = pnl.value;
  scheduleDailyPnlReset();

  const symbols = normalizeSymbols();
  for (const symbol of symbols) {
    let productId = await resolveProductIdBySymbol(rest, symbol);

    const market = new MarketCache();
    const indicators = new IndicatorCache(market);
    const context: SymbolContext = {
      symbol,
      market,
      indicators,
      structure: new StructureAnalyzer(),
      smc: new SmcAnalyzer(),
      lastClosed5m: 0,
      lastClosed15m: 0,
      running: false,
      productId,
    };

    symbolContexts.set(symbol, context);
    await bootstrapMarket(rest, market, symbol);
  }

  const ws = new DeltaWsClient(
    (msg: any) => {
      if (msg?.type === "v2/ticker") handleTickerMessage(msg);
      if (msg?.channel === "orders") handleOrderUpdate(msg);
      if (msg?.channel === "positions") handlePositionUpdate(msg);
    },
    (price: number, ctx: SymbolContext) => {
      ctx.market.ingestTick(price, 0, Date.now());
      if (paper) paper.onTick(price, ctx.productId, ctx.symbol);
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
      logger.info(`[ARES.MARKET] WS connected; subscribing to ticker (${symbolsForWs.join(",")})`);
      ws?.subscribe("v2/ticker", symbolsForWs);
    },
    {
      auth: env.TRADING_MODE === "live",
      onAuth: (success) => {
        if (!success) return;
        ws?.subscribe("orders", ["all"]);
        ws?.subscribe("positions", ["all"]);
      },
    }
  );

  if (paper) {
    paper.setOnStateChange(persistState);
    paper.setOnOrderUpdate((orderId, status) => {
      orderManager.onPaperOrderUpdate(orderId, status);
      void ocoManager.onOrderUpdate(orderId, status);
    });
  }

  logger.info("[ARES.BOOT] System ready; transitioning to RUNNING");
  fsm.setSystemState(SystemState.RUNNING);
  ws.connect();
}

async function onNew5mClose(ctx: SymbolContext) {
  const closed15m = ctx.market.lastClosed("15m");
  if (!closed15m || closed15m.timestamp === ctx.lastClosed15m) return;
  ctx.lastClosed15m = closed15m.timestamp;

  const bias = computeHTFBias(ctx.market, ctx.indicators);
  if (bias === "NONE") {
    fsm.setMarketRegime(MarketRegime.UNKNOWN);
    return;
  }

  fsm.setMarketRegime(bias === "LONG" ? MarketRegime.TRENDING_BULL : MarketRegime.TRENDING_BEAR);

  ctx.structure.update(closed15m);
  if (ctx.structure.lastBias) {
    fsm.setStructureState(ctx.structure.lastBias === "BULLISH" ? StructureState.BULLISH_STRUCTURE : StructureState.BEARISH_STRUCTURE);
  }

  const atr = ctx.indicators.snapshot("15m").atr14;
  ctx.smc.update(closed15m, ctx.structure.lastBreaks, ctx.structure.lastSwings, true, atr);

  const riskCtx = await getRiskContext(ctx.symbol);
  if (riskCtx.equity <= 0) {
    logger.warn("[ARES.RISK] Equity zero; blocking execution");
    fsm.setRiskState(RiskState.NORMAL);
    return;
  }

  const signal = await runStrategy(ctx.market, ctx.indicators, ctx.structure, ctx.smc);
  if (!signal) {
    fsm.setSignalState(SignalState.IDLE);
    return;
  }

  fsm.setSignalState(SignalState.READY_TO_EXECUTE);

  const veto = await aiVeto(aiClient, {
    symbol: ctx.symbol,
    bias: bias as any,
    intent: "ENTRY",
    context: {
      price: ctx.market.lastPrice(),
      structure: ctx.structure.lastBias ?? "NONE",
      smcScore: signal.score,
      reasons: signal.reasons,
    }
  });

  if (veto.action === "BLOCK") {
    logger.warn(`[ARES.AI] Veto BLOCK for ${ctx.symbol}: ${veto.reason}`);
    return;
  }

  const stop = bias === "LONG" ? closed15m.low : closed15m.high;
  const tp = computeTargets(ctx.market.lastPrice(), stop, bias as any, RISK_CONFIG.minRR);

  const set = await orderManager.execute({
    symbol: ctx.symbol,
    productId: ctx.productId as number,
    side: bias as any,
    entryPrice: ctx.market.lastPrice(),
    qty: 1,
    stopPrice: stop,
    targetPrice: tp,
    signalContext: { htfBias: bias, smcScore: signal.score, rr: RISK_CONFIG.minRR, reason: signal.reasons.join(" | ") }
  });

  if (set?.entryOrderId) fsm.setSignalState(SignalState.ORDER_PLACED);
}

function handleTickerMessage(msg: TickerMessage) {
  if (!msg.symbol || msg.price == null) return;
  const price = typeof msg.price === "string" ? Number(msg.price) : msg.price;
  watchlistLtps.set(msg.symbol, price);
  const ctx = symbolContexts.get(msg.symbol);
  if (ctx) ctx.market.ingestTick(price, 0, Date.now());
}

function handleOrderUpdate(msg: any) {
}

function handlePositionUpdate(msg: any) {
}

bootstrap().catch((e) => {
  logger.error("BOOT FAILURE", e);
  process.exit(1);
});
