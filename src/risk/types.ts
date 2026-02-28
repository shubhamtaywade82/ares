export interface RiskContext {
  balance: number;
  dailyPnl: number;
  openTrades: number;
  openTradesBySymbol: Record<string, number>;
}

export interface TradeRiskInput {
  symbol: string;
  entryPrice: number;
  stopPrice: number;
  side: "LONG" | "SHORT";
  minLotSize: number;
  contractValue: number;
  inrToUsd: number;
}

export interface PositionSizeResult {
  qty: number;
  riskAmount: number;
  stopDistance: number;
}
