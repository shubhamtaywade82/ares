export type AIIntent = "ENTRY" | "EXIT" | "PULSE";

export interface AIVetoInput {
  intent: AIIntent;
  symbol: string;
  lastPrice: number;
  side: "LONG" | "SHORT";
  timeframeBias: {
    htf: "BULL" | "BEAR" | "RANGE";
    rsi: number;
    emaSlope: "UP" | "DOWN" | "FLAT";
  };
  setupQuality?: {
    score: number;
    reasons: string[];
  } | undefined;
  volatility: {
    atr: number;
    atrPercentile: number;
  };
  indicators: {
    ema20: number;
    ema200: number;
    vwap: number;
  };
  marketContext: {
    fundingRate?: number;
    session: "ASIA" | "EU" | "US";
    smc?: {
      activeSweep?: "BULL_TRAP" | "BEAR_TRAP" | undefined;
      activeSweepAgeMinutes?: number | undefined;
      activeSweepVolumeRatio?: number | undefined;
      nearestBullishOb?: { top: number; bottom: number; distPct: number; isInside: boolean } | undefined;
      nearestBearishOb?: { top: number; bottom: number; distPct: number; isInside: boolean } | undefined;
      nearestBullishFvg?: { top: number; bottom: number; distPct: number; isInside: boolean } | undefined;
      nearestBearishFvg?: { top: number; bottom: number; distPct: number; isInside: boolean } | undefined;
    } | undefined;
  };
}
