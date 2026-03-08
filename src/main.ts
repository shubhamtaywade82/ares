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
import { BracketBuilder } from "./execution/bracket.builder.js";
import { TradeJournal } from "./execution/trade.journal.js";
import { ActivePosition } from "./execution/trade.types.js";

import { eventBus, MarketEventType, CandleEvent } from "./market/event.bus.js";

type TickerMessage = {
  type?: string;
  price?: number | string;
  mark_price?: number | string;
  close?: number | string;
  spot_price?: number | string;
  volume?: number | string;
  timestamp?: number;
  symbol?: string;
};

type OhlcvMessage = {
  type: "v2/ohlcv";
  symbol: string;
  data: {
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
    time: number;
    interval: string;
  };
};

function tickerPrice(msg: TickerMessage): number | null {
  const raw = msg.mark_price ?? msg.close ?? msg.spot_price ?? msg.price;
  if (raw == null) return null;
  return typeof raw === "string" ? Number(raw) : raw;
}

type SymbolContext = {
  symbol: string;
  productId?: number | undefined;
  market: MarketCache;
  indicators: IndicatorCache;
  lastCandleTimes: Map<string, number>;
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

const AI_ANALYSIS_LOG_MAX = 20;
const aiAnalysisLog: Array<{ symbol: string; intent: string; decision: "ALLOW" | "BLOCK"; reason: string; timestamp: number }> = [];

function pushAiAnalysis(symbol: string, intent: string, allowed: boolean, reason: string): void {
  aiAnalysisLog.unshift({
    symbol,
    intent,
    decision: allowed ? "ALLOW" : "BLOCK",
    reason,
    timestamp: Date.now(),
  });
  if (aiAnalysisLog.length > AI_ANALYSIS_LOG_MAX) aiAnalysisLog.pop();
}

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
    equity,
    availableBalance,
    openTrades,
    openTradesBySymbol,
    dailyPnl: env.TRADING_MODE === "paper" ? pnl.value - dailyPnlBaseline : 0,
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
  const tickers = Array.from(symbolContexts.entries()).map(([symbol, ctx]) => {
    let lastPrice = ctx.market.lastPrice();
    if (lastPrice <= 0) {
      const last5m = ctx.market.lastClosed("5m");
      if (last5m) lastPrice = last5m.close;
    }
    if (lastPrice <= 0) {
      const last15m = ctx.market.lastClosed("15m");
      if (last15m) lastPrice = last15m.close;
    }
    return { symbol, lastPrice };
  });
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
    market: { tickers },
    aiAnalysis: aiAnalysisLog.slice(0, 15),
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
  const raw = env.DELTA_PRODUCT_SYMBOLS ?? env.DELTA_PRODUCT_SYMBOL;
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
      lastCandleTimes: new Map(),
      running: false,
      productId,
    };

    symbolContexts.set(symbol, context);
    await bootstrapMarket(rest, market, symbol);
  }

  const ws = new DeltaWsClient(
    (msg: any) => {
      if (msg?.type === "v2/ticker") {
        handleTickerMessage(msg);
        const price = tickerPrice(msg);
        if (price == null || !msg.symbol) return;
        const ctx = symbolContexts.get(msg.symbol);
        if (ctx) {
          ctx.market.ingestTick(price, 0, Date.now());
          if (paper) paper.onTick(price, ctx.productId, ctx.symbol);
        }
      }
      if (msg?.type === "v2/ohlcv") {
        handleOhlcvMessage(msg);
      }
      if (msg?.channel === "orders") handleOrderUpdate(msg);
      if (msg?.channel === "positions") handlePositionUpdate(msg);
    },
    () => {
      logger.error("KILL SWITCH TRIGGERED");
      process.exit(1);
    },
    async () => {
      const symbolsForWs = Array.from(symbolContexts.keys());
      logger.info(`[ARES.MARKET] WS connected; subscribing to ticker and ohlcv (1m, 5m, 15m) (${symbolsForWs.join(",")})`);
      ws?.subscribe("v2/ticker", symbolsForWs);
      ws?.subscribe("v2/ohlcv", symbolsForWs, ["1m", "5m", "15m"] as any);
    },
    {
      auth: env.TRADING_MODE === "live",
      onAuth: (success: boolean) => {
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

  // Hook Strategy to Event Bus
  eventBus.on(MarketEventType.CANDLE_CLOSE, (event: CandleEvent) => {
    const ctx = symbolContexts.get(event.symbol);
    if (ctx && event.timeframe === "15m") {
      void scanSymbol(ctx);
    }
  });

  logger.info("[ARES.BOOT] System ready; transitioning to RUNNING");
  fsm.setSystemState(SystemState.RUNNING);
  ws.connect();
}

async function scanSymbol(ctx: SymbolContext) {
  const bias = computeHTFBias(ctx.market, ctx.indicators);
  if (bias === "NONE") {
    fsm.setMarketRegime(MarketRegime.UNKNOWN);
    return;
  }

  fsm.setMarketRegime(bias === "LONG" ? MarketRegime.TRENDING_BULL : MarketRegime.TRENDING_BEAR);

  // Update structure and SMC context (15m execution TF)
  const candles15m = ctx.market.candles("15m");
  ctx.structure.update(candles15m);
  
  if (ctx.structure.lastBias) {
    fsm.setStructureState(ctx.structure.lastBias === "BULLISH" ? StructureState.BULLISH_STRUCTURE : StructureState.BEARISH_STRUCTURE);
  }

  const atr = ctx.indicators.snapshot("15m").atr14;
  ctx.smc.update(candles15m, ctx.structure.lastBreaks, ctx.structure.lastSwings, true, atr);

  // Check for ACTIVE candle displacement if in HTF supply/demand
  const currentPrice = ctx.market.lastPrice();
  const currentVolume = ctx.market.lastClosed("1m")?.volume ?? 0; // Rough approximation of current 15m volume expansion
  
  const activeDisplacement = ctx.smc.lastDisplacement === null ? 
    (ctx.smc as any).displacementDetector.detectActive(
      currentPrice, 
      currentVolume, 
      candles15m, 
      atr ?? 0, 
      ctx.structure.lastSwings,
      undefined, // auto-compute avg vol
      { fvgs: ctx.smc.lastFVGs, sweeps: ctx.smc.lastSweeps, currentBarIndex: candles15m.length }
    ) : null;

  if (activeDisplacement) {
    logger.info(`[ARES.STRATEGY] ACTIVE displacement detected for ${ctx.symbol}: ${activeDisplacement.type}`);
    fsm.setSignalState(SignalState.READY_TO_EXECUTE);
    // Trigger execution logic here...
    await executeEntry(ctx, bias, activeDisplacement);
  }
}

async function executeEntry(ctx: SymbolContext, bias: string, displacement: any) {
  const riskCtx = await getRiskContext(ctx.symbol);
  if (riskCtx.equity <= 0) return;

  const stop = displacement.pullbackZone.stop;
  const tp = computeTargets(ctx.market.lastPrice(), stop, bias as any, RISK_CONFIG.minRR);

  const set = await orderManager.execute({
    symbol: ctx.symbol,
    productId: ctx.productId as number,
    side: bias as any,
    entryPrice: ctx.market.lastPrice(),
    qty: 1,
    stopPrice: stop,
    targetPrice: tp,
    signalContext: { htfBias: bias, smcScore: 0.8, rr: RISK_CONFIG.minRR, reason: "Active Displacement" }
  });

  if (set?.entryOrderId) fsm.setSignalState(SignalState.ORDER_PLACED);
}

function handleOhlcvMessage(msg: OhlcvMessage) {
  const ctx = symbolContexts.get(msg.symbol);
  if (!ctx) return;

  const data = msg.data;
  const candle = {
    timestamp: data.time * 1000,
    open: Number(data.open),
    high: Number(data.high),
    low: Number(data.low),
    close: Number(data.close),
    volume: Number(data.volume),
  };

  const tf = data.interval as any;
  ctx.market.ingestCandle(tf, candle);

  const lastTime = ctx.lastCandleTimes.get(tf) ?? 0;
  if (lastTime !== 0 && candle.timestamp > lastTime) {
    // The previous candle just closed because we have a new timestamp.
    // However, the event we received is the BEGINNING of the new candle.
    // We need the ACTUAL closed candle from the cache.
    const closedCandle = ctx.market.lastClosed(tf);
    if (closedCandle) {
      eventBus.emitCandle({
        symbol: msg.symbol,
        timeframe: tf,
        candle: closedCandle,
        isClosed: true,
      });
    }
  }

  ctx.lastCandleTimes.set(tf, candle.timestamp);

  // Also emit update for current candle
  eventBus.emitCandle({
    symbol: msg.symbol,
    timeframe: tf,
    candle,
    isClosed: false,
  });
}

function handleTickerMessage(msg: TickerMessage) {
  const price = tickerPrice(msg);
  if (price == null || !msg.symbol) return;
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
