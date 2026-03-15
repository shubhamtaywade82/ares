import "dotenv/config";
import http from "http";
import { v4 as uuid } from "uuid";
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
import { env, isDevMode, isSimulatedMode, isTestFlowMode } from "./config/env.js";
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
import { getRuntimeTier, setRuntimeTier } from "./config/runtime.js";
import type { AggressionTier } from "./config/runtime.js";
import {
  SmcStateSnapshot,
  evaluateTierReadiness,
  TIER_REQUIREMENTS,
} from "./strategy/tier.filter.js";
import { savePaperState, loadPaperState } from "./state/persistence.js";
import { BracketBuilder } from "./execution/bracket.builder.js";
import { TradeJournal } from "./execution/trade.journal.js";
import { ActivePosition, ExitReason } from "./execution/trade.types.js";
import { ExitManager } from "./execution/exit.manager.js";
import { calculatePositionSize } from "./risk/position.sizer.js";

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
  type: "candlesticks";
  symbol: string;
  resolution: string;
  candle: {
    open: string | number;
    high: string | number;
    low: string | number;
    close: string | number;
    volume: string | number;
    time: number;
  };
};

const tickerPrice = (msg: TickerMessage): number | null => {
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
const paper = isSimulatedMode() ? new PaperExecutor(positions, pnl) : undefined;
const ocoManager = new OcoManager(orderStore, rest, env.TRADING_MODE, paper);
const activePositions = new Map<string, ActivePosition>();
const bracketBuilder = new BracketBuilder(rest);
const tradeJournal = new TradeJournal();
const orderManager = new OrderManager(rest, orderStore, env.TRADING_MODE, paper, bracketBuilder, activePositions);
const exitManager = new ExitManager(rest, bracketBuilder, tradeJournal, activePositions, {
  isDailyLossBreached: () => {
    const equity = cachedBalance ?? env.PAPER_BALANCE ?? 0;
    const dailyPnl = pnl.value - dailyPnlBaseline;
    return dailyPnl <= -(equity * RISK_CONFIG.maxDailyLossPct);
  },
  recordTrade: (pnlValue: number) => {
    pnl.record(pnlValue * RISK_CONFIG.USDINR);
  },
  activateKillSwitch: (reason: string) => {
    KillSwitch.trigger(KillReason.MAX_DAILY_LOSS, { reason });
  },
  resolveContractValue: (symbol: string) => {
    return Number(symbolContexts.get(symbol.toUpperCase())?.cachedProduct?.contract_value ?? 1);
  },
});

const symbolContexts = new Map<string, SymbolContext>();
const livePositions = new Map<string, any>();
const watchlistLtps = new Map<string, number>();

const closingSymbols = new Set<string>();

const AI_ANALYSIS_LOG_MAX = 20;
const aiAnalysisLog: Array<{ symbol: string; intent: string; decision: "ALLOW" | "BLOCK"; reason: string; timestamp: number }> = [];

const pushAiAnalysis = (symbol: string, intent: string, allowed: boolean, reason: string): void => {
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

const getRiskContext = async (symbol: string): Promise<RiskContext> => {
  let balance =
    isSimulatedMode()
      ? env.PAPER_BALANCE ?? cachedBalance ?? 0
      : cachedBalance ?? 0;

  if (!isSimulatedMode()) {
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

  if (isSimulatedMode() && balance <= 0 && env.PAPER_BALANCE != null) {
      balance = env.PAPER_BALANCE;
      cachedBalance = balance;
  }

  let equity = balance;
  let availableBalance = balance;

  if (isSimulatedMode()) {
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
    dailyPnl: isSimulatedMode() ? pnl.value - dailyPnlBaseline : 0,
  };
}

const countOpenTradesBySymbol = (symbol: string): number => {
  const key = symbol.toUpperCase();
  if (isSimulatedMode()) {
    return positions.all().filter((pos) => pos.productSymbol?.toUpperCase() === key).length;
  }
  const pos = livePositions.get(key);
  const size = Number(pos?.size ?? 0);
  return Number.isFinite(size) && size !== 0 ? 1 : 0;
}

const API_PORT = env.ARES_API_PORT;

const buildSmcSnapshot = (
  ctx: SymbolContext,
  effectiveBias: string
): SmcStateSnapshot => {
  const currentPrice = ctx.market.lastPrice();
  const pd = ctx.structure.premiumDiscount(currentPrice);

  const isLong = effectiveBias === "LONG";
  const premiumDiscountAligned =
    pd !== null &&
    pd.zone !== "EQUILIBRIUM" &&
    ((isLong && pd.zone === "DISCOUNT") || (!isLong && pd.zone === "PREMIUM"));

  return {
    htfBiasAligned: effectiveBias !== "NONE",
    inObZone: !!ctx.smc.nearestOB(
      currentPrice,
      isLong ? "BULLISH" : "BEARISH"
    )?.isInside,
    inFvgZone: !!ctx.smc.nearestFVG(
      currentPrice,
      isLong ? "BULLISH" : "BEARISH"
    )?.isInside,
    sweepDetected: ctx.smc.activeSweep !== undefined,
    displacementDetected: ctx.smc.lastDisplacement !== null,
    bosConfirmed: ctx.structure.lastBreaks.some((b) =>
      isLong
        ? b.side === "UP" && b.type === "BOS"
        : b.side === "DOWN" && b.type === "BOS"
    ),
    breakerConfluence: !!ctx.smc.nearestBreaker(
      currentPrice,
      isLong ? "BULLISH" : "BEARISH"
    )?.isInside,
    inducementDetected: (() => {
      const ind = ctx.smc.activeInducement;
      if (!ind) return false;
      return (
        (isLong &&
          ind.type === "BEAR_INDUCEMENT" &&
          ind.isSwept) ||
        (!isLong && ind.type === "BULL_INDUCEMENT" && ind.isSwept)
      );
    })(),
    premiumDiscountAligned,
    premiumDiscount: pd,
  };
};

const getStatePayload = async (): Promise<object> => {
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
    activePositions: Array.from(activePositions.values()).map((pos) => {
      const markPrice = watchlistLtps.get(pos.symbol) ?? pos.entryPrice;
      const contractValue = Number(
        symbolContexts.get(pos.symbol)?.cachedProduct?.contract_value ?? 1
      );
      const leverage = resolveMaxLeverage(pos.symbol);
      const direction = pos.side === "buy" ? 1 : -1;
      const pnlUsd = direction * (markPrice - pos.entryPrice) * pos.filledQty * contractValue;
      const positionPnl = pnlUsd * RISK_CONFIG.USDINR;
      const marginINR = pos.entryPrice * pos.filledQty * contractValue * RISK_CONFIG.USDINR / leverage;
      const pnlPercent = marginINR > 0 ? (positionPnl / marginINR) * 100 : 0;
      return { ...pos, markPrice, pnl: positionPnl, pnlPercent };
    }),
    history: tradeJournal.history.slice(-10),
    market: { tickers },
    aiAnalysis: aiAnalysisLog.slice(0, 15),
    smcData: Object.fromEntries(
      Array.from(symbolContexts.entries()).map(([symbol, ctx]) => {
        const currentPrice = watchlistLtps.get(symbol) ?? ctx.market.lastPrice();
        const pd = ctx.structure.premiumDiscount(currentPrice);
        const bias = ctx.structure.lastBias;
        const effectiveBias =
          bias === "BULLISH" ? "LONG" : bias === "BEARISH" ? "SHORT" : "NONE";
        const snapshot = buildSmcSnapshot(ctx, effectiveBias);
        const tier = getRuntimeTier();
        const tierResult = evaluateTierReadiness(tier, snapshot);
        const conditionNames: Array<{
          key: keyof typeof TIER_REQUIREMENTS.aggressive;
          label: string;
        }> = [
          { key: "htfBias", label: "HTF Bias" },
          { key: "obOrFvgZone", label: "OB/FVG Zone" },
          { key: "sweep", label: "Sweep" },
          { key: "displacement", label: "Displacement" },
          { key: "bos", label: "BOS" },
          { key: "breaker", label: "Breaker" },
          { key: "inducement", label: "Inducement" },
          { key: "premiumDiscount", label: "Prem/Discount" },
        ];
        const reqs = TIER_REQUIREMENTS[tier];
        const conditions = conditionNames
          .filter(({ key }) => reqs[key] !== "ignored")
          .map(({ key, label }) => ({
            name: label,
            met: tierResult.met.includes(key),
            required: reqs[key] === "required",
          }));
        return [
          symbol,
          {
            bias: ctx.structure.lastBias,
            swings: ctx.structure.lastSwings.slice(-5),
            breaks: ctx.structure.lastBreaks.slice(-3),
            fvgs: ctx.smc.lastFVGs,
            orderBlocks: ctx.smc.lastOBs,
            sweeps: ctx.smc.lastSweeps.slice(-3),
            activeSweep: ctx.smc.activeSweep ?? null,
            sweepMetrics: ctx.smc.activeSweepMetrics(),
            displacement: ctx.smc.lastDisplacement,
            breakerBlocks: ctx.smc.lastBreakers,
            inducements: ctx.smc.lastInducements,
            premiumDiscount: pd,
            tierReadiness: {
              currentTier: tier,
              conditions,
              readiness: tierResult.readiness,
            },
          },
        ];
      })
    ),
  };
}

const stateServer = http.createServer(async (req, res) => {
  // Do not handle WebSocket upgrade in the request handler — let WebSocketServer take it (otherwise dashboard gets 404 and never receives state)
  if (req.headers.upgrade === "websocket") {
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
    return;
  }

  // Dev/paper only: seed one position for a symbol (e.g. ETHUSD) for monitoring. Uses market order so it fills immediately.
  if (req.method === "POST" && req.url?.startsWith("/api/dev/seed")) {
    if (!isSimulatedMode() || !paper) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Seed only available in paper or dev mode" }));
      return;
    }
    const url = new URL(req.url ?? "", `http://localhost`);
    const symbol = (url.searchParams.get("symbol") ?? "ETHUSD").trim().toUpperCase();
    const ctx = symbolContexts.get(symbol);
    if (!ctx) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Symbol ${symbol} not in watchlist` }));
      return;
    }
    if (ctx.productId == null) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Product ID not resolved for ${symbol}` }));
      return;
    }
    if (activePositions.has(symbol)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Position already open for ${symbol}` }));
      return;
    }
    try {
      const riskCtx = await getRiskContext(symbol);
      if (riskCtx.equity <= 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Equity <= 0; set PAPER_BALANCE" }));
        return;
      }
      if (riskCtx.openTrades >= RISK_CONFIG.maxOpenTradesTotal) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Max open trades (${RISK_CONFIG.maxOpenTradesTotal}) reached` }));
        return;
      }
      const currentPrice = ctx.market.lastPrice();
      if (currentPrice <= 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `No price for ${symbol} yet; wait for ticker` }));
        return;
      }
      const atr = ctx.indicators.snapshot("15m").atr14 ?? currentPrice * 0.02;
      const stopDistance = atr * 1.5;
      const bias: "LONG" | "SHORT" = "LONG";
      const stop = bias === "LONG" ? currentPrice - stopDistance : currentPrice + stopDistance;
      const tp = computeTargets(currentPrice, stop, bias, RISK_CONFIG.minRR);
      const res_ = calculatePositionSize({
        equity: riskCtx.equity,
        availableBalance: riskCtx.availableBalance,
        symbol,
        entryPrice: currentPrice,
        stopPrice: stop,
        side: bias,
        minLotSize: Number(ctx.cachedProduct?.lot_size ?? 1),
        contractValue: Number(ctx.cachedProduct?.contract_value ?? 1),
        inrToUsd: 1 / RISK_CONFIG.USDINR,
      });
      if (!res_ || res_.qty <= 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Position size 0; check risk config" }));
        return;
      }
      const set = await orderManager.execute({
        symbol,
        productId: ctx.productId,
        side: bias,
        entryPrice: currentPrice,
        qty: res_.qty,
        stopPrice: stop,
        targetPrice: tp,
        useMarketEntry: true,
        signalContext: { htfBias: bias, smcScore: 0.8, rr: RISK_CONFIG.minRR, reason: "Dev seed" },
      });
      // Ensure the market order fills: push a tick so paper executor fills it (in case lastPrice wasn't set yet)
      paper.onTick(currentPrice, ctx.productId, ctx.symbol);
      const positionCreated = activePositions.has(symbol);
      if (positionCreated) logger.info(`[ARES.API] Seed position created for ${symbol}; activePositions now ${activePositions.size}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message: `Seed position placed for ${symbol}`,
          symbol,
          side: bias,
          entryOrderId: set?.entryOrderId,
          entryPrice: currentPrice,
          stopPrice: stop,
          targetPrice: tp,
          qty: res_.qty,
          positionCreated,
          activePositionCount: activePositions.size,
        })
      );
    } catch (err) {
      logger.error(err, "[ARES.API] Dev seed failed");
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Seed failed", detail: String(err) }));
    }
    return;
  }

  // Dev/paper: debug endpoint to verify active positions (GET so you can open in browser)
  if (req.method === "GET" && req.url === "/api/dev/active-positions") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        count: activePositions.size,
        positions: Array.from(activePositions.entries()).map(([sym, p]) => ({
          symbol: sym,
          side: p.side,
          entryPrice: p.entryPrice,
          entryQty: p.entryQty,
          slPrice: p.slPrice,
          tp1Price: p.tp1Price,
        })),
      })
    );
    return;
  }

  if (req.method === "GET" && req.url === "/api/config/tier") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tier: getRuntimeTier() }));
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/api/config/tier")) {
    const url = new URL(req.url ?? "", "http://localhost");
    const level = url.searchParams.get("level");
    const validTiers: AggressionTier[] = [
      "aggressive",
      "moderate",
      "conservative",
    ];
    if (!level || !validTiers.includes(level as AggressionTier)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `Invalid tier. Must be one of: ${validTiers.join(", ")}`,
        })
      );
      return;
    }
    setRuntimeTier(level as AggressionTier);
    logger.info(`[ARES.CONFIG] Aggression tier changed to '${level}'`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tier: level }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: stateServer });

const normalizeSymbols = (): string[] => {
  const raw = env.DELTA_PRODUCT_SYMBOLS ?? env.DELTA_PRODUCT_SYMBOL;
  if (!raw) return ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"];
  return raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

const resolveProductBySymbol = async (restClient: DeltaRestClient, symbol: string): Promise<{ productId?: number; product?: any }> => {
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
    if (!match) return {};
    const rawId = match?.id ?? match?.product_id;
    const id = typeof rawId === "string" ? Number(rawId) : rawId;
    if (Number.isFinite(id)) return { productId: Number(id), product: match };
    return { product: match };
  } catch (error) {
    logger.error(error, `[ARES.MARKET] Failed to resolve product for ${symbol}:`);
  }
  return {};
}

const persistState = async () => {
    if (isSimulatedMode()) {
      await savePaperState({ realizedPnl: pnl.value, positions: positions.all() });
    }
}

const scheduleDailyPnlReset = () => {
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

const bootstrap = async () => {
  stateServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error(`[ARES.API] Port ${API_PORT} already in use. Stop the other process or set ARES_API_PORT to a different port.`);
    } else {
      logger.error(err, "[ARES.API] State server error");
    }
    process.exit(1);
  });

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

  // AI Health Check
  const aiHealthy = await aiClient.healthCheck();
  if (!aiHealthy) {
    logger.warn("[ARES.AI] AI Client health check failed. Veto layer may be degraded.");
  } else {
    logger.info("[ARES.AI] AI Client connected and healthy.");
  }

  if (isSimulatedMode()) {
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
    const { productId, product } = await resolveProductBySymbol(rest, symbol);

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
      cachedProduct: product,
    };

    symbolContexts.set(symbol, context);

    // Set leverage and contract value on paper executor for correct margin/PnL calculations
    if (paper && productId != null) {
      const leverage = resolveMaxLeverage(symbol);
      paper.setOrderLeverage(productId, symbol, leverage);
      const contractValue = Number(product?.contract_value ?? 1);
      paper.setContractValue(productId, symbol, contractValue);
    }

    await bootstrapMarket(rest, market, symbol);
  }

  const ws = new DeltaWsClient(
    (msg: any) => {
      if (process.env.LOG_LEVEL === "debug") {
        console.log(`[ARES.WS.MSG] type=${msg?.type} symbol=${msg?.symbol}`);
      }
      if (msg?.type === "v2/ticker" || msg?.type === "ticker") {
        handleTickerMessage(msg);
        const price = tickerPrice(msg);
        if (price == null || !msg.symbol) return;
        const ctx = symbolContexts.get(msg.symbol);
        if (ctx) {
          ctx.market.ingestTick(price, 0, Date.now());
          if (paper) paper.onTick(price, ctx.productId, ctx.symbol);
          // Check profit target exit on every tick for all modes
          void checkProfitTargetExit(ctx.symbol, price);
        }
      }
      if (msg?.type?.startsWith("candlestick_")) {
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
      logger.info(`[ARES.MARKET] WS connected; subscribing to v2/ticker and candlesticks (1m, 5m, 15m, 1h, 4h, 1d) (${symbolsForWs.join(",")})`);
      ws?.subscribe("v2/ticker", symbolsForWs);
      
      const resolutions = ["1m", "5m", "15m", "1h", "4h", "1d"];
      for (const res of resolutions) {
        ws?.subscribe(`candlestick_${res}`, symbolsForWs);
      }
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
    paper.setOnStateChange(async () => {
      // Sync activePositions with position store — remove closed positions so dashboard updates
      for (const [symbol] of activePositions) {
        const pos = positions.getByProduct(undefined, symbol);
        if (!pos) {
          activePositions.delete(symbol);
          logger.info(`[ARES.PAPER] Position ${symbol} closed; removed from active positions`);
        }
      }
      await persistState();
      // In test_flow mode, if we had a position and now it's gone, we've completed the cycle.
      if (isTestFlowMode() && positions.all().length === 0 && pnl.value !== dailyPnlBaseline) {
        const finalPnl = pnl.value - dailyPnlBaseline;
        logger.info("================================================================");
        logger.info("TEST FLOW COMPLETED SUCCESSFULLY");
        logger.info(`Final Realized PnL: ₹${finalPnl.toFixed(2)}`);
        logger.info("The full lifecycle (entry -> position -> exit) has been verified.");
        logger.info("================================================================");
        setTimeout(() => process.exit(0), 1000); // Small delay for logs to flush
      }
    });
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

  eventBus.on(MarketEventType.CANDLE_UPDATE, (event: CandleEvent) => {
    const ctx = symbolContexts.get(event.symbol);
    if (ctx && event.timeframe === "15m") {
      void scanSymbol(ctx);
    }
  });

  // Live mode: reconcile existing positions on boot
  if (env.TRADING_MODE === "live") {
    try {
      const positionsRes = await rest.getPositions();
      const openPositions = Array.isArray(positionsRes?.result) ? positionsRes.result : [];
      const ordersRes = await rest.getOrders({ state: "open" });
      const openOrders = Array.isArray(ordersRes?.result) ? ordersRes.result : [];

      await exitManager.reconcileOnBoot(
        openPositions,
        openOrders,
        Boolean(env.BOOT_CLOSE_ORPHAN_POSITIONS),
        async (symbol: string) => {
          const pos = openPositions.find(
            (p: any) => String(p.product_symbol ?? p.symbol ?? "").toUpperCase() === symbol
          );
          const size = Math.abs(Number(pos?.size ?? 0));
          const side = Number(pos?.size ?? 0) > 0 ? "sell" : "buy";
          if (size > 0) {
            await rest.placeOrder({
              product_symbol: symbol,
              side,
              order_type: "market_order",
              size,
              reduce_only: true,
            });
          }
        }
      );
      logger.info(`[ARES.BOOT] Live reconciliation complete: ${openPositions.length} positions, ${openOrders.length} orders`);
    } catch (err) {
      logger.error(err, "[ARES.BOOT] Live reconciliation failed");
    }
  }

  logger.info("[ARES.BOOT] System ready; transitioning to RUNNING");
  if (isTestFlowMode()) {
    logger.info("[ARES.TEST] TEST_FLOW mode active — will force immediate entry and tight exit to verify full pipeline");
  } else if (isDevMode()) {
    logger.info("[ARES.DEV] Dev mode active — relaxed gates (daily loss, bias, displacement, AI veto) to exercise full pipeline: entries, positions, brackets, exits, PnL");
  }
  fsm.setSystemState(SystemState.RUNNING);
  ws.connect();
}

const scanSymbol = async (ctx: SymbolContext) => {
  // Prevent concurrent scans for the same symbol (CANDLE_CLOSE + CANDLE_UPDATE fire in parallel)
  if (ctx.running) return;
  ctx.running = true;
  try {
    await scanSymbolInner(ctx);
  } finally {
    ctx.running = false;
  }
};

const scanSymbolInner = async (ctx: SymbolContext) => {
  if (KillSwitch.isTriggered()) {
    fsm.setSystemState(SystemState.ERROR);
    return;
  }

  const riskCtx = await getRiskContext(ctx.symbol);
  
  // Daily Loss Check (percentage based) — skipped in dev so we can exercise full pipeline
  if (!isDevMode() && riskCtx.dailyPnl <= -(riskCtx.equity * RISK_CONFIG.maxDailyLossPct)) {
    KillSwitch.trigger(KillReason.MAX_DAILY_LOSS, { pnl: riskCtx.dailyPnl });
    return;
  }

  const bias = computeHTFBias(ctx.market, ctx.indicators);
  // In dev mode, force a direction when strategy returns NONE so we can test entries/exits
  const effectiveBias = (bias === "NONE" && isDevMode())
    ? (env.FORCE_HTF_BIAS === "SHORT" ? "SHORT" : "LONG")
    : bias;
  if (effectiveBias === "NONE") {
    fsm.setMarketRegime(MarketRegime.UNKNOWN);
    return;
  }

  fsm.setMarketRegime(effectiveBias === "LONG" ? MarketRegime.TRENDING_BULL : MarketRegime.TRENDING_BEAR);

  // Update structure and SMC context (15m execution TF)
  const candles15m = ctx.market.candles("15m");
  ctx.structure.update(candles15m);
  
  if (ctx.structure.lastBias) {
    fsm.setStructureState(ctx.structure.lastBias === "BULLISH" ? StructureState.BULLISH_STRUCTURE : StructureState.BEARISH_STRUCTURE);
  }

  const atr = ctx.indicators.snapshot("15m").atr14;
  ctx.smc.update(candles15m, ctx.structure.lastBreaks, ctx.structure.lastSwings, true, atr);

  const smcSnapshot = buildSmcSnapshot(ctx, effectiveBias);
  const tier = getRuntimeTier();
  const tierResult = evaluateTierReadiness(tier, smcSnapshot);
  if (!tierResult.passed && !isDevMode()) {
    logger.debug(
      `[ARES.STRATEGY] Tier '${tier}' gate not passed for ${ctx.symbol}. Unmet: ${tierResult.unmet.join(", ")}`
    );
    if (fsm.canTransitionToSignal(SignalState.HTF_BIAS_CONFIRMED))
      fsm.setSignalState(SignalState.HTF_BIAS_CONFIRMED);
    if (ctx.structure.lastBias && fsm.canTransitionToSignal(SignalState.STRUCTURE_ALIGNED))
      fsm.setSignalState(SignalState.STRUCTURE_ALIGNED);
    return;
  }

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

  // Synthetic displacement: dev/test_flow always; paper only when PAPER_SYNTHETIC_DISPLACEMENT=true (so paper can exercise pipeline without rare real SMC displacement).
  const allowSynthetic =
    isDevMode() ||
    (isSimulatedMode() && env.PAPER_SYNTHETIC_DISPLACEMENT && candles15m.length >= 2 && (isTestFlowMode() || (candles15m.length >= 20 && (atr ?? 0) > 0)));
  const displacement =
    activeDisplacement ??
    (allowSynthetic
      ? {
          type: effectiveBias,
          pullbackZone: {
            entry: currentPrice,
            stop:
              effectiveBias === "LONG"
                ? currentPrice - Math.max(atr ?? 0, currentPrice * 0.001) * 1.5
                : currentPrice + Math.max(atr ?? 0, currentPrice * 0.001) * 1.5,
          },
        }
      : null);

  if (displacement) {
    if (activeDisplacement) {
      logger.info(`[ARES.STRATEGY] ACTIVE displacement detected for ${ctx.symbol}: ${activeDisplacement.type}`);
    } else {
      logger.info(
        `[ARES.${isTestFlowMode() ? "TEST" : isDevMode() ? "DEV" : "PAPER"}] Synthetic displacement for ${ctx.symbol} (bias=${effectiveBias}) — exercising full pipeline`
      );
    }
    // Drive FSM through valid path so dashboard shows Bias OK → Aligned → Ready (only if transition allowed)
    if (fsm.canTransitionToSignal(SignalState.HTF_BIAS_CONFIRMED))
      fsm.setSignalState(SignalState.HTF_BIAS_CONFIRMED);
    if (fsm.canTransitionToSignal(SignalState.STRUCTURE_ALIGNED))
      fsm.setSignalState(SignalState.STRUCTURE_ALIGNED);
    if (fsm.canTransitionToSignal(SignalState.DISPLACEMENT_DETECTED))
      fsm.setSignalState(SignalState.DISPLACEMENT_DETECTED);
    if (fsm.canTransitionToSignal(SignalState.PULLBACK_DETECTED))
      fsm.setSignalState(SignalState.PULLBACK_DETECTED);
    if (fsm.canTransitionToSignal(SignalState.REJECTION_CONFIRMED))
      fsm.setSignalState(SignalState.REJECTION_CONFIRMED);
    if (fsm.canTransitionToSignal(SignalState.READY_TO_EXECUTE))
      fsm.setSignalState(SignalState.READY_TO_EXECUTE);
    await executeEntry(ctx, effectiveBias, displacement);
  } else {
    // Update FSM so dashboard shows Bias OK / Aligned even when no displacement yet (only if transition allowed)
    if (fsm.canTransitionToSignal(SignalState.HTF_BIAS_CONFIRMED))
      fsm.setSignalState(SignalState.HTF_BIAS_CONFIRMED);
    if (ctx.structure.lastBias && fsm.canTransitionToSignal(SignalState.STRUCTURE_ALIGNED))
      fsm.setSignalState(SignalState.STRUCTURE_ALIGNED);
  }
};

const executeEntry = async (ctx: SymbolContext, bias: string, displacement: any) => {
  const riskCtx = await getRiskContext(ctx.symbol);
  if (riskCtx.equity <= 0) return;

  // Max Exposure Check
  if (riskCtx.openTrades >= RISK_CONFIG.maxOpenTradesTotal) {
    logger.warn(`[ARES.RISK] Max concurrent trades reached (${riskCtx.openTrades})`);
    return;
  }

  // Prevent duplicate entries for same symbol
  if (activePositions.has(ctx.symbol.toUpperCase())) return;

  const currentPrice = ctx.market.lastPrice();
  let stop = displacement.pullbackZone.stop;
  let tp = computeTargets(currentPrice, stop, bias as any, RISK_CONFIG.minRR);

  // In TEST_FLOW mode, force very tight TP/SL to see the exit quickly
  if (isTestFlowMode()) {
    const tinyRisk = currentPrice * 0.0005; // 0.05%
    stop = bias === "LONG" ? currentPrice - tinyRisk : currentPrice + tinyRisk;
    tp = bias === "LONG" ? currentPrice + tinyRisk : currentPrice - tinyRisk;
    logger.info(`[ARES.TEST] Forcing tight targets: Entry:${currentPrice.toFixed(2)} SL:${stop.toFixed(2)} TP:${tp.toFixed(2)}`);
  }

  // Position Sizing
  const minLotSize = Number(ctx.cachedProduct?.lot_size ?? 1);
  const contractValue = Number(ctx.cachedProduct?.contract_value ?? 1);
  logger.info(`[ARES.SIZING] ${ctx.symbol} entry=${currentPrice.toFixed(2)} stop=${stop.toFixed(2)} equity=${riskCtx.equity.toFixed(2)} avail=${riskCtx.availableBalance.toFixed(2)} contractValue=${contractValue} lotSize=${minLotSize} product=${ctx.cachedProduct ? 'loaded' : 'MISSING'}`);
  const res = calculatePositionSize({
    equity: riskCtx.equity,
    availableBalance: riskCtx.availableBalance,
    symbol: ctx.symbol,
    entryPrice: currentPrice,
    stopPrice: stop,
    side: bias as any,
    minLotSize,
    contractValue,
    inrToUsd: 1 / RISK_CONFIG.USDINR,
  });

  if (!res || res.qty <= 0) {
    logger.warn(`[ARES.RISK] Calculated qty 0 for ${ctx.symbol}; check risk settings.`);
    return;
  }

  const { qty } = res;

  // AI Veto Layer — skip entirely in dev/test_flow mode to avoid Ollama timeout blocking entries
  if (!isDevMode()) {
    const indicators = ctx.indicators.snapshot("15m");
    const smcMetrics = ctx.smc.activeSweepMetrics();

    const vetoInput: AIVetoInput = {
      symbol: ctx.symbol,
      intent: "ENTRY",
      side: bias as any,
      lastPrice: currentPrice,
      timeframeBias: {
        htf: bias === "LONG" ? "BULL" : "BEAR",
        rsi: indicators.rsi14 ?? 50,
        emaSlope: "FLAT",
      },
      volatility: {
        atr: indicators.atr14 ?? 0,
        atrPercentile: 50,
      },
      indicators: {
        ema20: indicators.ema20 ?? 0,
        ema200: indicators.ema200 ?? 0,
        vwap: indicators.vwap ?? 0,
      },
      marketContext: {
        session: "ASIA",
        smc: {
          activeSweep: ctx.smc.activeSweep?.type,
          activeSweepAgeMinutes: smcMetrics?.ageMinutes,
          activeSweepVolumeRatio: smcMetrics?.volumeRatio,
          nearestBullishOb: ctx.smc.nearestOB(currentPrice, "BULLISH") ?? undefined,
          nearestBearishOb: ctx.smc.nearestOB(currentPrice, "BEARISH") ?? undefined,
          nearestBullishFvg: ctx.smc.nearestFVG(currentPrice, "BULLISH") ?? undefined,
          nearestBearishFvg: ctx.smc.nearestFVG(currentPrice, "BEARISH") ?? undefined,
        }
      }
    };

    const { allowed, reason } = await aiVeto(aiClient, vetoInput);
    pushAiAnalysis(ctx.symbol, "ENTRY", allowed, reason);

    if (!allowed) {
      fsm.setSignalState(SignalState.IDLE);
      return;
    }
  } else {
    logger.info(`[ARES.DEV] AI veto skipped for ${ctx.symbol} — dev mode`);
  }

  const set = await orderManager.execute({
    symbol: ctx.symbol,
    productId: ctx.productId as number,
    side: bias as any,
    entryPrice: currentPrice,
    qty,
    stopPrice: stop,
    targetPrice: tp,
    signalContext: { htfBias: bias, smcScore: 0.8, rr: RISK_CONFIG.minRR, reason: "Active Displacement" }
  });

  if (set?.entryOrderId && fsm.canTransitionToSignal(SignalState.ORDER_PLACED))
    fsm.setSignalState(SignalState.ORDER_PLACED);
}

const handleOhlcvMessage = (msg: any) => {
  const ctx = symbolContexts.get(msg.symbol);
  if (!ctx) return;

  const resolution = msg.resolution ?? msg.type.split("_")[1];
  if (process.env.LOG_LEVEL === "debug") console.log(`[ARES.MARKET] Received OHLCV for ${msg.symbol} ${resolution}`);

  const candleData = msg.candle ?? msg;
  
  let rawTime = candleData.time ?? candleData.timestamp;
  let timestamp = Number(rawTime);
  
  // Normalize to milliseconds:
  // - Microseconds (16 digits): divide by 1000
  // - Seconds (10 digits): multiply by 1000
  // - Already Milliseconds (13 digits): keep as is
  if (timestamp > 1e15) timestamp = Math.floor(timestamp / 1000);
  else if (timestamp < 1e12) timestamp = timestamp * 1000;

  const candle = {
    timestamp,
    open: Number(candleData.open),
    high: Number(candleData.high),
    low: Number(candleData.low),
    close: Number(candleData.close),
    volume: Number(candleData.volume),
  };

  const tf = resolution as any;
  ctx.market.ingestCandle(tf, candle);
  
  // Update Indicators asynchronously
  void ctx.indicators.update(tf);

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

const checkProfitTargetExit = async (symbol: string, price: number) => {
  const upperSymbol = symbol.toUpperCase();
  const pos = activePositions.get(upperSymbol);
  if (!pos || closingSymbols.has(upperSymbol)) return;

  const contractValue = Number(
    symbolContexts.get(upperSymbol)?.cachedProduct?.contract_value ?? 1
  );
  const leverage = resolveMaxLeverage(upperSymbol);
  const direction = pos.side === "buy" ? 1 : -1;
  const pnlUsd = direction * (price - pos.entryPrice) * pos.filledQty * contractValue;
  const marginUsd = pos.entryPrice * pos.filledQty * contractValue / leverage;

  if (marginUsd <= 0 || (pnlUsd / marginUsd) < RISK_CONFIG.profitTargetPct) return;

  closingSymbols.add(upperSymbol);
  const pnlPct = ((pnlUsd / marginUsd) * 100).toFixed(1);
  logger.info(`[ARES.EXECUTION] Profit target ${pnlPct}% hit for ${upperSymbol} — closing position`);

  try {
    const closeSide = pos.side === "buy" ? "sell" : "buy";

    if (isSimulatedMode() && paper) {
      // Cancel bracket orders through the paper executor (not REST API)
      if (pos.slOrderId) paper.cancel(pos.slOrderId);
      if (pos.tp1OrderId) paper.cancel(pos.tp1OrderId);
      if (pos.tp2OrderId) paper.cancel(pos.tp2OrderId);
      if (pos.beSlOrderId) paper.cancel(pos.beSlOrderId);

      // Close via paper executor market order
      paper.placeOrder({
        product_symbol: upperSymbol,
        size: pos.filledQty,
        side: closeSide,
        order_type: "market",
      });
    } else if (env.TRADING_MODE === "live") {
      // Cancel all bracket orders on Delta Exchange
      await Promise.allSettled([
        pos.slOrderId ? rest.cancelOrder(pos.slOrderId) : Promise.resolve(),
        pos.tp1OrderId ? rest.cancelOrder(pos.tp1OrderId) : Promise.resolve(),
        pos.tp2OrderId ? rest.cancelOrder(pos.tp2OrderId) : Promise.resolve(),
        pos.beSlOrderId ? rest.cancelOrder(pos.beSlOrderId) : Promise.resolve(),
      ]);

      // Try post-only limit first to save on fees
      let filled = false;
      try {
        const limitOrder = await rest.placeOrder({
          product_symbol: upperSymbol,
          side: closeSide,
          order_type: "limit_order",
          limit_price: String(price),
          post_only: true,
          size: pos.filledQty,
          reduce_only: true,
        });
        const limitOrderId = String(limitOrder?.result?.id ?? "");

        // Wait 5s for limit fill, then fall back to market
        if (limitOrderId) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          try {
            await rest.cancelOrder(limitOrderId);
          } catch {
            // Order already filled or cancelled — that's fine
            filled = true;
          }
        }
      } catch {
        // Post-only rejected (would cross) — go straight to market
      }

      if (!filled) {
        await rest.placeOrder({
          product_symbol: upperSymbol,
          side: closeSide,
          order_type: "market_order",
          size: pos.filledQty,
          reduce_only: true,
        });
      }
    }

    // Record the trade
    const realizedPnl = pnlUsd;
    const riskUsdt = Math.abs(pos.entryPrice - pos.slPrice) * pos.entryQty * contractValue;
    tradeJournal.write({
      id: uuid(),
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      entryQty: pos.entryQty,
      entryTime: pos.entryTime,
      tp1Price: pos.tp1Price,
      tp1FilledPrice: pos.tp1FillPrice,
      tp1FilledQty: pos.tp1FillQty,
      tp1FilledTime: pos.tp1FilledTime,
      tp2Price: pos.tp2Price,
      tp2FilledPrice: null,
      tp2FilledQty: null,
      tp2FilledTime: null,
      slPrice: pos.slPrice,
      slFilledPrice: null,
      slFilledQty: null,
      slFilledTime: null,
      exitReason: "PROFIT_TARGET" as ExitReason,
      realizedPnl,
      rMultiple: riskUsdt > 0 ? realizedPnl / riskUsdt : 0,
      closedTime: Date.now(),
      signal: pos.signal,
      entryOrderId: pos.entryOrderId,
      slOrderId: pos.slOrderId,
      tp1OrderId: pos.tp1OrderId,
      tp2OrderId: pos.tp2OrderId,
    });

    pnl.record(realizedPnl * RISK_CONFIG.USDINR);
    activePositions.delete(upperSymbol);
    logger.info(`[ARES.EXECUTION] Profit target exit complete for ${upperSymbol} — PnL: ${realizedPnl.toFixed(4)} USD`);
  } catch (err) {
    logger.error(err, `[ARES.EXECUTION] Profit target exit failed for ${upperSymbol}`);
  } finally {
    closingSymbols.delete(upperSymbol);
  }
};

const handleTickerMessage = (msg: TickerMessage) => {
  const price = tickerPrice(msg);
  if (price == null || !msg.symbol) return;
  if (process.env.LOG_LEVEL === "debug") console.log(`[ARES.MARKET] Received Ticker for ${msg.symbol}: ${price}`);
  watchlistLtps.set(msg.symbol, price);
  const ctx = symbolContexts.get(msg.symbol);
  if (ctx) ctx.market.ingestTick(price, 0, Date.now());
}

const handleOrderUpdate = (msg: any) => {
  if (env.TRADING_MODE !== "live") return;

  // Delta WS sends order data inside msg.data or at top level
  const data = msg.data ?? msg;
  const orderId = String(data.id ?? data.order_id ?? "");
  const status = String(data.state ?? data.status ?? "").toLowerCase();
  const symbol = String(data.product_symbol ?? data.symbol ?? "").toUpperCase();
  const filledQty = Number(data.filled_qty ?? data.size ?? 0);
  const avgFillPrice = Number(data.average_fill_price ?? data.fill_price ?? 0);

  if (!orderId) return;

  logger.info(`[ARES.WS] Order update: ${orderId} status=${status} symbol=${symbol} filled=${filledQty}`);

  // Check if this is a bracket fill (SL/TP)
  if (exitManager.isBracketOrder(orderId) && status === "closed") {
    void exitManager.onBracketFill(orderId, filledQty, avgFillPrice);
    return;
  }

  // Check if this is an entry order fill
  if (status === "closed" && filledQty > 0) {
    void orderManager.onLiveEntryFilled(orderId, filledQty, avgFillPrice);
  } else if (status === "open" && filledQty > 0) {
    void orderManager.onLiveEntryPartialFill(orderId, filledQty);
  }
}

const handlePositionUpdate = (msg: any) => {
  if (env.TRADING_MODE !== "live") return;

  const data = msg.data ?? msg;
  const symbol = String(data.product_symbol ?? data.symbol ?? "").toUpperCase();
  const size = Number(data.size ?? 0);

  if (!symbol) return;

  logger.info(`[ARES.WS] Position update: ${symbol} size=${size}`);
  livePositions.set(symbol, data);

  // If position is flat, clean up activePositions
  if (size === 0 && activePositions.has(symbol)) {
    activePositions.delete(symbol);
    logger.info(`[ARES.WS] Position ${symbol} is flat; removed from active positions`);
  }
}

bootstrap().catch((e) => {
  logger.error("BOOT FAILURE", e);
  process.exit(1);
});
