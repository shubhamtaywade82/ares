import { DeltaCandle } from "../delta/types.js";

export type Timeframe = "1m" | "5m" | "15m";

export interface IndicatorSnapshot {
  ema20?: number;
  ema200?: number;
  rsi14?: number;
  atr14?: number;
  vwap?: number;
  ready: boolean;
}
