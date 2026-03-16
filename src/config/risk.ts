import { USD_INR_RATE } from "../finance/fx.js";

export const RISK_CONFIG = {
  riskPerTradePct: 0.02,
  maxDailyLossPct: 0.05,
  maxOpenTradesTotal: 6,
  maxOpenTradesPerSymbol: 2,
  minRR: 1.5,
  profitTargetPct: 0.10,
  defaultMaxLeverage: 5,
  maxLeverageBySymbol: {
    BTCUSD: 10,
    ETHUSD: 8,
    XRPUSD: 5,
    SOLUSD: 5,
  } as Record<string, number>,
  USDINR: USD_INR_RATE,
  GST_RATE: 0.18,
};

export const resolveMaxLeverage = (symbol?: string): number => {
  if (!symbol) return RISK_CONFIG.defaultMaxLeverage;
  const upper = symbol.toUpperCase();
  return RISK_CONFIG.maxLeverageBySymbol[upper] ?? RISK_CONFIG.defaultMaxLeverage;
}
