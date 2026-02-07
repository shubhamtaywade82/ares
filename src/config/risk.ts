export const RISK_CONFIG = {
  riskPerTradePct: 0.003,
  maxDailyLossPct: 0.02,
  maxOpenTrades: 1,
  minRR: 1.5,
  defaultMaxLeverage: 5,
  maxLeverageBySymbol: {
    BTCUSD: 10,
    ETHUSD: 8,
    XRPUSD: 5,
    SOLUSD: 6,
  } as Record<string, number>,
};

export function resolveMaxLeverage(symbol?: string): number {
  if (!symbol) return RISK_CONFIG.defaultMaxLeverage;
  const upper = symbol.toUpperCase();
  return RISK_CONFIG.maxLeverageBySymbol[upper] ?? RISK_CONFIG.defaultMaxLeverage;
}
