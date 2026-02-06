export interface AIVetoInput {
  symbol: string;
  side: "LONG" | "SHORT";
  timeframeBias: {
    htf: "BULL" | "BEAR" | "RANGE";
    rsi: number;
    emaSlope: "UP" | "DOWN" | "FLAT";
  };
  setupQuality: {
    score: number;
    reasons: string[];
  };
  volatility: {
    atr: number;
    atrPercentile: number;
  };
  marketContext: {
    fundingRate?: number;
    session: "ASIA" | "EU" | "US";
  };
}
