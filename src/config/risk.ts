export const RISK_CONFIG = {
  riskPerTradePct: 0.01,
  maxDailyLossPct: 0.02,
  maxOpenTradesTotal: 4,
  maxOpenTradesPerSymbol: 1,
  minRR: 1.5,
  defaultMaxLeverage: 5,
  maxLeverageBySymbol: {
    BTCUSD: 10,
    ETHUSD: 8,
    XRPUSD: 5,
    SOLUSD: 5,
  } as Record<string, number>,
  USDINR: 84.0,
  GST_RATE: 0.18,
};

export function resolveMaxLeverage(symbol?: string): number {
  if (!symbol) return RISK_CONFIG.defaultMaxLeverage;
  const upper = symbol.toUpperCase();
  return RISK_CONFIG.maxLeverageBySymbol[upper] ?? RISK_CONFIG.defaultMaxLeverage;
}
