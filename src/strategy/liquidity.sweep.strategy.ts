import { randomUUID } from "node:crypto";
import { eventBus, MarketEventType, OrderbookEvent, AggrTradeEvent } from "../market/event.bus.js";
import { logger } from "../utils/logger.js";

// ─── Config ────────────────────────────────────────────────────────

const SWEEP_THRESHOLD_PCT = 0.2;   // % beyond prior swing to confirm a sweep
const ABSORPTION_RATIO = 1.5;      // orderbook flip ratio to confirm absorption
const FLOW_CONFIRM = 5;            // minimum net flow for confirming reversal
const SWEEP_EXPIRY_MS = 10_000;    // invalidate sweep detection after 10s
const SPREAD_MAX_PCT = 0.15;       // max spread % to take a trade
const COOLDOWN_MS = 5000;
const FLOW_RESET_MS = 2000;
const DEPTH_LEVELS = 5;

// ─── State ─────────────────────────────────────────────────────────

interface SweepState {
  direction: "UP" | "DOWN";
  sweepPrice: number;
  timestamp: number;
}

interface LSSSymbolState {
  lastHigh: number;
  lastLow: number;
  sweep: SweepState | null;
  latestOB: OrderbookEvent | null;
  buyFlow: number;
  sellFlow: number;
  lastSignalTime: number;
}

const state = new Map<string, LSSSymbolState>();

const getState = (symbol: string): LSSSymbolState => {
  if (!state.has(symbol)) {
    state.set(symbol, {
      lastHigh: 0,
      lastLow: Infinity,
      sweep: null,
      latestOB: null,
      buyFlow: 0,
      sellFlow: 0,
      lastSignalTime: 0,
    });
  }
  return state.get(symbol)!;
};

// ─── Flow reset ────────────────────────────────────────────────────

setInterval(() => {
  for (const s of state.values()) {
    s.buyFlow = 0;
    s.sellFlow = 0;
  }
}, FLOW_RESET_MS);

// ─── Listeners ─────────────────────────────────────────────────────

eventBus.on(MarketEventType.ORDERBOOK_UPDATE, (ob: OrderbookEvent) => {
  getState(ob.symbol).latestOB = ob;
});

eventBus.on(MarketEventType.AGGR_TRADE, (trade: AggrTradeEvent) => {
  const s = getState(trade.symbol);
  if (trade.side === "buy") s.buyFlow += trade.size;
  else s.sellFlow += trade.size;
});

eventBus.on(MarketEventType.TICK, (tick: { symbol: string; price: number; timestamp: number }) => {
  const s = getState(tick.symbol);
  const { price, symbol } = tick;

  // --- Track range ---
  if (price > s.lastHigh) s.lastHigh = price;
  if (price < s.lastLow) s.lastLow = price;

  // --- Detect sweep ---
  if (s.lastHigh > 0 && price > s.lastHigh * (1 + SWEEP_THRESHOLD_PCT / 100)) {
    s.sweep = { direction: "UP", sweepPrice: price, timestamp: Date.now() };
  }
  if (s.lastLow < Infinity && price < s.lastLow * (1 - SWEEP_THRESHOLD_PCT / 100)) {
    s.sweep = { direction: "DOWN", sweepPrice: price, timestamp: Date.now() };
  }

  if (!s.sweep || !s.latestOB) return;

  // --- Expire sweep ---
  if (Date.now() - s.sweep.timestamp > SWEEP_EXPIRY_MS) {
    s.sweep = null;
    return;
  }

  // --- Cooldown ---
  if (Date.now() - s.lastSignalTime < COOLDOWN_MS) return;

  const bids = s.latestOB.bids.slice(0, DEPTH_LEVELS);
  const asks = s.latestOB.asks.slice(0, DEPTH_LEVELS);
  if (bids.length === 0 || asks.length === 0) return;

  const bidVol = bids.reduce((sum, [, sz]) => sum + sz, 0);
  const askVol = asks.reduce((sum, [, sz]) => sum + sz, 0);
  const imbalance = bidVol / (askVol || 1);

  const bestBid = bids[0]?.[0];
  const bestAsk = asks[0]?.[0];
  if (bestBid == null || bestAsk == null) return;

  const spreadPct = ((bestAsk - bestBid) / bestBid) * 100;
  if (spreadPct > SPREAD_MAX_PCT) return;

  const delta = s.buyFlow - s.sellFlow;

  // Anti-fake filter
  if (Math.abs(delta) < 2) return;

  // ─── Bearish sweep → SHORT (price swept up then rejected) ─────
  if (s.sweep.direction === "UP") {
    const sweep = s.sweep; // capture before nulling
    const reclaim = price < sweep.sweepPrice * 0.999;
    const absorption = imbalance < 1 / ABSORPTION_RATIO;
    const flowFlip = delta < -FLOW_CONFIRM;

    if (reclaim && absorption && flowFlip) {
      const signal = {
        id: randomUUID(),
        symbol,
        side: "SHORT" as const,
        entry: price,
        stopLoss: sweep.sweepPrice * 1.002,
        takeProfit: price * 0.992,
        confidence: 0.9,
        meta: {
          strategy: "liquidity_sweep_short",
          sweepPrice: sweep.sweepPrice,
          imbalance,
          delta,
        },
      };
      s.lastSignalTime = Date.now();
      s.sweep = null;
      eventBus.emitSignal(signal);
      logger.info(
        `[ARES.STRATEGY.LSS] SHORT sweep-reclaim ${symbol} sweep=${sweep.sweepPrice} entry=${price}`
      );
    }
  }

  // ─── Bullish sweep → LONG (price swept down then reclaimed) ──
  if (s.sweep !== null && s.sweep.direction === "DOWN") {
    const sweep = s.sweep; // capture before nulling
    const reclaim = price > sweep.sweepPrice * 1.001;
    const absorption = imbalance > ABSORPTION_RATIO;
    const flowFlip = delta > FLOW_CONFIRM;

    if (reclaim && absorption && flowFlip) {
      const signal = {
        id: randomUUID(),
        symbol,
        side: "LONG" as const,
        entry: price,
        stopLoss: sweep.sweepPrice * 0.998,
        takeProfit: price * 1.008,
        confidence: 0.9,
        meta: {
          strategy: "liquidity_sweep_long",
          sweepPrice: sweep.sweepPrice,
          imbalance,
          delta,
        },
      };
      s.lastSignalTime = Date.now();
      s.sweep = null;
      eventBus.emitSignal(signal);
      logger.info(
        `[ARES.STRATEGY.LSS] LONG sweep-reclaim ${symbol} sweep=${sweep.sweepPrice} entry=${price}`
      );
    }
  }
});

logger.info("[ARES.STRATEGY.LSS] Liquidity sweep strategy initialized");
