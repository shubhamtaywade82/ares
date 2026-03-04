export interface AIVetoInput {
  intent: "ENTRY" | "EXIT";
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
      activeSweep?: "BULL_TRAP" | "BEAR_TRAP";
      activeSweepAgeMinutes?: number;
      activeSweepVolumeRatio?: number;
      nearestBullishOb?: { top: number; bottom: number; distPct: number; isInside: boolean };
      nearestBearishOb?: { top: number; bottom: number; distPct: number; isInside: boolean };
      nearestBullishFvg?: { top: number; bottom: number; distPct: number; isInside: boolean };
      nearestBearishFvg?: { top: number; bottom: number; distPct: number; isInside: boolean };
    };
  };
}
