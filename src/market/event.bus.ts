import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { DeltaCandle } from "../delta/types.js";
import { appendEvent } from "../core/event.store.js";

export enum MarketEventType {
  TRADE = "TRADE",
  TICK = "TICK",
  CANDLE_UPDATE = "CANDLE_UPDATE",
  CANDLE_CLOSE = "CANDLE_CLOSE",
  STRUCTURE_BREAK = "STRUCTURE_BREAK",
  DISPLACEMENT = "DISPLACEMENT",
  LIQUIDITY_SWEEP = "LIQUIDITY_SWEEP",
  PULLBACK_DETECTED = "PULLBACK_DETECTED",
  SIGNAL_READY = "SIGNAL_READY",
  ORDER_FILLED = "ORDER_FILLED",
  POSITION_CLOSED = "POSITION_CLOSED",

  // Orderbook / tradeflow (for microstructure strategies)
  ORDERBOOK_UPDATE = "ORDERBOOK_UPDATE",
  AGGR_TRADE = "AGGR_TRADE",
}

export interface CandleEvent {
  symbol: string;
  timeframe: string;
  candle: DeltaCandle;
  isClosed: boolean;
}

export interface OrderbookEvent {
  symbol: string;
  bids: [number, number][];  // [price, size][]
  asks: [number, number][];  // [price, size][]
  timestamp: number;
}

export interface AggrTradeEvent {
  symbol: string;
  price: number;
  size: number;
  side: "buy" | "sell";
  timestamp: number;
}

/** Whether event persistence is active. Disabled during backtest runs. */
let persistenceEnabled = true;

export const enableEventPersistence = () => { persistenceEnabled = true; };
export const disableEventPersistence = () => { persistenceEnabled = false; };

export class MarketEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  emitTrade(symbol: string, price: number, volume: number) {
    const payload = { symbol, price, volume, timestamp: Date.now() };
    this.emitRaw(MarketEventType.TRADE, payload);
  }

  emitCandle(event: CandleEvent) {
    this.emitRaw(MarketEventType.CANDLE_UPDATE, event);
    if (event.isClosed) {
      this.emitRaw(MarketEventType.CANDLE_CLOSE, event);
    }
  }

  emitSignal(signal: unknown) {
    this.emitRaw(MarketEventType.SIGNAL_READY, signal);
  }

  emitOrderbook(event: OrderbookEvent) {
    this.emitRaw(MarketEventType.ORDERBOOK_UPDATE, event);
  }

  emitAggrTrade(event: AggrTradeEvent) {
    this.emitRaw(MarketEventType.AGGR_TRADE, event);
  }

  /**
   * Core emit with optional persistence.
   * @param suppressPersist Pass true from the replay engine to avoid re-writing replayed events.
   */
  emitRaw(type: string, payload: unknown, suppressPersist = false) {
    if (persistenceEnabled && !suppressPersist) {
      appendEvent({ id: randomUUID(), type, payload, timestamp: Date.now() });
    }
    this.emit(type, payload);
  }
}

export const eventBus = new MarketEventBus();
