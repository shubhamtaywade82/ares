export interface RiskContext {
  balance: number;
  dailyPnl: number;
  openTrades: number;
}

export interface TradeRiskInput {
  entryPrice: number;
  stopPrice: number;
  side: "LONG" | "SHORT";
  minLotSize: number;
}

export interface PositionSizeResult {
  qty: number;
  riskAmount: number;
  stopDistance: number;
}
