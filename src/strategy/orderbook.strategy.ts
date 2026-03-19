import { randomUUID } from "node:crypto";
import { eventBus, MarketEventType, OrderbookEvent, AggrTradeEvent } from "../market/event.bus.js";
import { logger } from "../utils/logger.js";

// ─── Config ────────────────────────────────────────────────────────

const IMBALANCE_LONG = 1.3;     // bid/ask ratio for bullish signal
const IMBALANCE_SHORT = 1 / IMBALANCE_LONG;  // inverse for bearish
const MIN_FLOW_DELTA = 5;       // minimum net aggressive volume
const MAX_SPREAD_PCT = 0.15;    // maximum spread % before aborting
const DEPTH_LEVELS = 5;         // use top N levels of orderbook
const FLOW_RESET_MS = 2000;     // reset trade flow accumulator every N ms
const COOLDOWN_MS = 5000;       // min time between signals per symbol
const ANTI_SPOOF_IMBALANCE = 2.5; // if imbalance > this but flow negative → likely spoofing

// ─── State ─────────────────────────────────────────────────────────

interface SymbolState {
  latestOB: OrderbookEvent | null;
  buyFlow: number;
  sellFlow: number;
  lastSignalTime: number;
}

const state = new Map<string, SymbolState>();

const getState = (symbol: string): SymbolState => {
  if (!state.has(symbol)) {
    state.set(symbol, {
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
  const s = getState(ob.symbol);
  s.latestOB = ob;
});

eventBus.on(MarketEventType.AGGR_TRADE, (trade: AggrTradeEvent) => {
  const s = getState(trade.symbol);
  if (trade.side === "buy") s.buyFlow += trade.size;
  else s.sellFlow += trade.size;
});

eventBus.on(MarketEventType.TICK, (tick: { symbol: string; price: number; timestamp: number }) => {
  const s = getState(tick.symbol);
  if (!s.latestOB) return;

  // Cooldown
  if (Date.now() - s.lastSignalTime < COOLDOWN_MS) return;

  const bids = s.latestOB.bids.slice(0, DEPTH_LEVELS);
  const asks = s.latestOB.asks.slice(0, DEPTH_LEVELS);

  if (bids.length === 0 || asks.length === 0) return;

  const bidVol = bids.reduce((sum, [, sz]) => sum + sz, 0);
  const askVol = asks.reduce((sum, [, sz]) => sum + sz, 0);

  if (askVol === 0) return;

  const imbalance = bidVol / askVol;

  const bestBid = bids[0]?.[0];
  const bestAsk = asks[0]?.[0];

  if (bestBid == null || bestAsk == null) return;

  const spreadPct = ((bestAsk - bestBid) / bestBid) * 100;
  if (spreadPct > MAX_SPREAD_PCT) return;

  const delta = s.buyFlow - s.sellFlow;

  // Anti-spoofing: extreme imbalance but flow contradicts → reject
  if (imbalance > ANTI_SPOOF_IMBALANCE && delta < 0) return;
  if (imbalance < 1 / ANTI_SPOOF_IMBALANCE && delta > 0) return;

  // ─── LONG ─────────────────────────────────────────────────────
  if (imbalance > IMBALANCE_LONG && delta > MIN_FLOW_DELTA) {
    const signal = {
      id: randomUUID(),
      symbol: tick.symbol,
      side: "LONG" as const,
      entry: bestBid,
      stopLoss: bestBid * 0.996,
      takeProfit: bestBid * 1.008,
      confidence: 0.8,
      meta: { strategy: "orderbook_imbalance", imbalance, delta, spreadPct },
    };
    s.lastSignalTime = Date.now();
    eventBus.emitSignal(signal);
    logger.debug(
      `[ARES.STRATEGY.OB] LONG signal ${tick.symbol} imbalance=${imbalance.toFixed(2)} delta=${delta.toFixed(0)}`
    );
  }

  // ─── SHORT ────────────────────────────────────────────────────
  if (imbalance < IMBALANCE_SHORT && delta < -MIN_FLOW_DELTA) {
    const signal = {
      id: randomUUID(),
      symbol: tick.symbol,
      side: "SHORT" as const,
      entry: bestAsk,
      stopLoss: bestAsk * 1.004,
      takeProfit: bestAsk * 0.992,
      confidence: 0.8,
      meta: { strategy: "orderbook_imbalance", imbalance, delta, spreadPct },
    };
    s.lastSignalTime = Date.now();
    eventBus.emitSignal(signal);
    logger.debug(
      `[ARES.STRATEGY.OB] SHORT signal ${tick.symbol} imbalance=${imbalance.toFixed(2)} delta=${delta.toFixed(0)}`
    );
  }
});

logger.info("[ARES.STRATEGY.OB] Orderbook imbalance strategy initialized");
