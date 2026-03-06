import { MarketRegime } from "./ares.state.js";

/**
 * TRADE SIGNAL TAXONOMY
 * ARES must emit only canonical signal types.
 */
export enum SignalType {
  HTF_CONTINUATION = "HTF_CONTINUATION",
  HTF_REVERSAL = "HTF_REVERSAL",
  LIQUIDITY_SWEEP_REVERSAL = "LIQUIDITY_SWEEP_REVERSAL",
  BREAKOUT_EXPANSION = "BREAKOUT_EXPANSION",
  RANGE_ROTATION = "RANGE_ROTATION",
  MEAN_REVERSION = "MEAN_REVERSION",
  MOMENTUM_SCALP = "MOMENTUM_SCALP",
  FAILED_BREAK = "FAILED_BREAK",
  DISTRIBUTION_BREAK = "DISTRIBUTION_BREAK",
  VOLATILITY_COMPRESSION_BREAK = "VOLATILITY_COMPRESSION_BREAK",
  NO_TRADE = "NO_TRADE"
}

/**
 * MASTER TRADE SIGNAL SCHEMA
 * All signals must conform to this base schema.
 */
export interface TradeSignal {
  type: SignalType;
  direction: "LONG" | "SHORT";
  symbol: string;
  timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  regime: MarketRegime;

  structure: {
    htfBias?: "bullish" | "bearish";
    bosConfirmed?: boolean;
    chochConfirmed?: boolean;
    displacement?: boolean;
    liquiditySweep?: boolean;
  };

  entry: {
    model: "limit" | "market" | "stop_market";
    zone?: [number, number];
    trigger?: string;
  };

  stop: {
    type?: "structural" | "atr";
    level: number | string;
  };

  targets: {
    level: number | string;
    tag?: string;
  }[];

  riskReward: number;
  invalidation: string;
  confidence: number;
  timestamp: number;
}

/**
 * NO-TRADE STATE
 */
export interface NoTradeSignal {
  type: SignalType.NO_TRADE;
  symbol: string;
  regime: MarketRegime;
  htfBias: "bullish" | "bearish";
  ltfStructure: string;
  tradeAllowed: false;
  reason: string;
  timestamp: number;
}

export type ARESSignal = TradeSignal | NoTradeSignal;
