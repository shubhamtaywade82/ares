import { EventEmitter } from "node:events";
import { DeltaCandle } from "../delta/types.js";

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
  POSITION_CLOSED = "POSITION_CLOSED"
}

export interface CandleEvent {
  symbol: string;
  timeframe: string;
  candle: DeltaCandle;
  isClosed: boolean;
}

export class MarketEventBus extends EventEmitter {
  emitTrade(symbol: string, price: number, volume: number) {
    this.emit(MarketEventType.TRADE, { symbol, price, volume, timestamp: Date.now() });
  }

  emitCandle(event: CandleEvent) {
    this.emit(MarketEventType.CANDLE_UPDATE, event);
    if (event.isClosed) {
      this.emit(MarketEventType.CANDLE_CLOSE, event);
    }
  }

  emitSignal(signal: any) {
    this.emit(MarketEventType.SIGNAL_READY, signal);
  }
}

export const eventBus = new MarketEventBus();
