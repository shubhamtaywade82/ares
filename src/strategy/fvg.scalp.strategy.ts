import { randomUUID } from "node:crypto";
import { eventBus, MarketEventType } from "../market/event.bus.js";
import { logger } from "../utils/logger.js";
import { isEntryAllowedBySession, isRsiEntryValid } from "./session.filter.js";

/**
 * Bearish FVG Scalp Strategy
 * ─────────────────────────────────────────────────────────────────
 * Data-driven from live 5-min analysis (2026-03-20):
 *   - Bear FVGs outnumber Bull FVGs 1.3:1 on all pairs
 *   - All pairs RSI 70–73 (overbought) → short setups have structural backing
 *   - Volume imbalance: -9 to -13.5% (sellers dominate)
 *   - London session blocked; NY session preferred
 *
 * Signal logic:
 *   1. Track recent bearish FVGs (prev.low > next.high on 5m bars)
 *   2. When price wicks into an unfilled FVG zone from below (pullback into supply)
 *   3. RSI > 60 + close back below FVG top
 *   4. Enter SHORT with SL at FVG high + buffer, TP at 2× risk
 *
 * Risk: FVG avg size = 0.083–0.150% price → keeps SL tight relative to TP
 */

// ─── Config ────────────────────────────────────────────────────────
const FVG_LOOKBACK_BARS = 10;  // track FVGs from last N bars
const FVG_EXPIRY_BARS   = 20;  // invalidate FVG after N bars
const RSI_SELL_THRESHOLD = 60; // require RSI > 60 for SHORT entry (overbought context)
const SL_BUFFER_MULT    = 0.1; // extra buffer above FVG high as % of ATR
const RR_MIN            = 2.0; // minimum risk:reward
const SPREAD_MAX_PCT    = 0.10;// max spread % before skipping
const COOLDOWN_MS       = 300_000; // 5 min between signals per symbol

// ─── State ─────────────────────────────────────────────────────────
interface FVGZone {
  topPrice: number;
  botPrice: number;
  barIndex: number;
  side: "bull" | "bear";
  filled: boolean;
}

interface PerSymbolState {
  candles: Array<{ o: number; h: number; l: number; c: number; v: number; t: number }>;
  fvgs: FVGZone[];
  rsi: number;
  atr: number;
  barIndex: number;
  lastSignalTime: number;
  avgVol: number;
}

const state = new Map<string, PerSymbolState>();
const getState = (symbol: string): PerSymbolState => {
  if (!state.has(symbol)) {
    state.set(symbol, { candles: [], fvgs: [], rsi: 50, atr: 0, barIndex: 0, lastSignalTime: 0, avgVol: 0 });
  }
  return state.get(symbol)!;
};

// ─── RSI helper ────────────────────────────────────────────────────
function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let avgG = 0, avgL = 0;
  const start = closes.length - period - 1;
  for (let i = start; i < closes.length - 1; i++) {
    const prev = closes[i];
    const next = closes[i + 1];
    if (prev === undefined || next === undefined) continue;
    const d = next - prev;
    avgG += d > 0 ? d : 0;
    avgL += d < 0 ? -d : 0;
  }
  avgG /= period; avgL /= period;
  return avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
}

function calcATR(candles: PerSymbolState["candles"], period = 14): number {
  if (candles.length < 2) return 0;
  const slice = candles.slice(-(period + 1));
  const trs = slice.slice(1).map((c, i) => {
    const prev = slice[i];
    if (!prev) return c.h - c.l;
    return Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c));
  });
  return trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : 0;
}

// ─── Event listeners ──────────────────────────────────────────────

// On each closed candle, update FVG map and RSI
eventBus.on(MarketEventType.CANDLE_CLOSE, (event: any) => {
  if (!event?.candle) return;
  const s = getState(event.symbol);
  const c = event.candle;
  s.candles.push({ o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume, t: c.timestamp });
  if (s.candles.length > 50) s.candles.shift();

  s.barIndex++;

  // Detect FVGs using prev, curr, next pattern (only when we have 3+ candles)
  if (s.candles.length >= 3) {
    const len = s.candles.length;
    const prev = s.candles[len - 3]!;
    const next = s.candles[len - 1]!;
    // Bearish FVG: prev.low > next.high
    if (prev.l > next.h) {
      s.fvgs.push({ topPrice: prev.l, botPrice: next.h, barIndex: s.barIndex, side: "bear", filled: false });
    }
    // Bullish FVG: prev.high < next.low
    if (prev.h < next.l) {
      s.fvgs.push({ topPrice: next.l, botPrice: prev.h, barIndex: s.barIndex, side: "bull", filled: false });
    }
  }

  // Expire old FVGs
  s.fvgs = s.fvgs.filter(f => !f.filled && s.barIndex - f.barIndex < FVG_EXPIRY_BARS);

  // Update indicators
  const closes = s.candles.map(c => c.c);
  s.rsi = calcRSI(closes);
  s.atr = calcATR(s.candles);
  s.avgVol = s.candles.reduce((sum, c) => sum + c.v, 0) / s.candles.length;
});

// On each tick, check if price has wicked into a bearish FVG from below
eventBus.on(MarketEventType.TICK, (tick: any) => {
  const sym: string = tick.symbol;
  const price: number = tick.price;
  const s = getState(sym);

  if (!s.candles.length || !s.atr) return;
  if (Date.now() - s.lastSignalTime < COOLDOWN_MS) return;

  // Session filter
  const sessionCheck = isEntryAllowedBySession(Date.now(), { blockLondon: true });
  if (!sessionCheck.allowed) return;

  // RSI filter
  const rsiCheck = isRsiEntryValid(s.rsi, "SHORT");
  if (!rsiCheck.valid) return;

  // Find active bearish FVGs that price has entered
  for (const fvg of s.fvgs) {
    if (fvg.side !== "bear" || fvg.filled) continue;

    const withinFVG = price >= fvg.botPrice && price <= fvg.topPrice;
    if (!withinFVG) continue;

    // Mark filled once price enters
    fvg.filled = true;

    // Entry = FVG top (resistance), SL = slightly above FVG top, TP at 2× risk
    const slBuffer = s.atr * SL_BUFFER_MULT;
    const entry = fvg.topPrice;
    const stopLoss = fvg.topPrice + slBuffer;
    const risk = stopLoss - entry;
    const takeProfit = entry - risk * RR_MIN;

    if (risk <= 0 || takeProfit <= 0) continue;
    if (risk / entry * 100 > 0.5) continue; // skip wide SL

    const signal = {
      id: randomUUID(),
      symbol: sym,
      side: "SHORT" as const,
      entry,
      stopLoss,
      takeProfit,
      confidence: Math.min(0.9, 0.6 + (s.rsi - 60) / 100),
      meta: {
        strategy: "fvg_bearish_scalp",
        fvgTop: fvg.topPrice,
        fvgBot: fvg.botPrice,
        rsi: s.rsi.toFixed(1),
        atr: s.atr.toFixed(4),
        session: sessionCheck.session,
      },
    };

    s.lastSignalTime = Date.now();
    eventBus.emitSignal(signal);
    logger.info(
      `[ARES.STRATEGY.FVG] SHORT — ${sym} entry=${entry.toFixed(4)} sl=${stopLoss.toFixed(4)} tp=${takeProfit.toFixed(4)} RSI=${s.rsi.toFixed(1)}`
    );
    return; // one signal per tick max
  }
});

logger.info("[ARES.STRATEGY.FVG] Bearish FVG scalp strategy initialized");
