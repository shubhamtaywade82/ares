import { v4 as uuid } from "uuid";
import { MarketEventType, eventBus } from "../market/event.bus.js";
import { BacktestConfig, BacktestTrade } from "./types.js";

interface OpenPosition {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  qty: number;
  stopLoss: number;
  takeProfit: number;
  riskPerTrade: number;
}

/**
 * Simulated execution engine for backtest runs.
 *
 * Listens to the same event bus as live trading:
 *   - On SIGNAL_READY → opens a simulated position (no Delta API)
 *   - On TICK         → checks SL/TP and closes positions
 *
 * Designed to be initialized BEFORE candles are replayed.
 */
export class BacktestSimulator {
  private openPosition: OpenPosition | null = null;
  private trades: BacktestTrade[] = [];
  private capital: number;
  private readonly config: Required<BacktestConfig>;

  constructor(config: BacktestConfig) {
    this.capital = config.initialCapital;
    this.config = {
      contractValue: 1,
      ...config,
    };
  }

  /** Wire event listeners. Call once before replaying candles. */
  init() {
    eventBus.on(MarketEventType.SIGNAL_READY, (signal: any) => {
      if (this.openPosition) return; // one trade at a time

      const entry =
        signal.entry *
        (1 +
          (signal.side === "LONG" ? 1 : -1) *
            (this.config.slippagePct / 100));

      const riskPerTrade = Math.abs(entry - signal.stopLoss) * (signal.qty ?? 1) * this.config.contractValue;

      this.openPosition = {
        id: uuid(),
        symbol: signal.symbol ?? "UNKNOWN",
        side: signal.side,
        entry,
        qty: signal.qty ?? 1,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskPerTrade,
      };
    });

    eventBus.on(MarketEventType.TICK, (tick: any) => {
      if (!this.openPosition) return;

      const { side, stopLoss, takeProfit, entry, qty, id, symbol, riskPerTrade } =
        this.openPosition;
      const price = tick.price as number;

      const hitSL = side === "LONG" ? price <= stopLoss : price >= stopLoss;
      const hitTP = side === "LONG" ? price >= takeProfit : price <= takeProfit;

      if (!hitSL && !hitTP) return;

      const exit = price;
      const rawPnl =
        side === "LONG"
          ? (exit - entry) * qty * this.config.contractValue
          : (entry - exit) * qty * this.config.contractValue;
      const fee = Math.abs(rawPnl) * (this.config.feePct / 100);
      const pnl = rawPnl - fee;

      this.capital += pnl;
      this.trades.push({
        id,
        symbol,
        side,
        entry,
        exit,
        qty,
        pnl,
        rMultiple: riskPerTrade > 0 ? pnl / riskPerTrade : 0,
        timestamp: tick.timestamp ?? Date.now(),
        exitReason: hitTP ? "TP" : "SL",
      });

      this.openPosition = null;
    });
  }

  get completedTrades(): BacktestTrade[] {
    return this.trades;
  }

  get finalCapital(): number {
    return this.capital;
  }

  /** Reset state for a fresh backtest run. */
  reset() {
    this.openPosition = null;
    this.trades = [];
    this.capital = this.config.initialCapital;
  }
}
