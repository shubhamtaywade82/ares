export type ExitReason = "TP1" | "TP2" | "SL" | "MANUAL" | "KILL_SWITCH" | "PROFIT_TARGET";
export type PositionStage = "ENTRY_PENDING" | "OPEN_FULL" | "OPEN_PARTIAL" | "FLAT";

export interface TradeSignalContext {
  htfBias: string;
  smcScore: number;
  rr: number;
  reason: string;
}

export interface ActivePosition {
  entryOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  entryPrice: number;
  entryQty: number;
  filledQty: number;
  entryTime: number;
  stage: PositionStage;
  slPrice: number;
  tp1Price: number;
  tp2Price: number;
  slOrderId: string | null;
  tp1OrderId: string | null;
  tp2OrderId: string | null;
  beSlOrderId: string | null;
  tp1FillPrice: number | null;
  tp1FillQty: number | null;
  tp1FilledTime: number | null;
  tp2FillPrice: number | null;
  tp2FillQty: number | null;
  tp2FilledTime: number | null;
  slFillPrice: number | null;
  slFillQty: number | null;
  slFilledTime: number | null;
  signal: TradeSignalContext;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  entryPrice: number;
  entryQty: number;
  entryTime: number;
  tp1Price: number;
  tp1FilledPrice: number | null;
  tp1FilledQty: number | null;
  tp1FilledTime: number | null;
  tp2Price: number;
  tp2FilledPrice: number | null;
  tp2FilledQty: number | null;
  tp2FilledTime: number | null;
  slPrice: number;
  slFilledPrice: number | null;
  slFilledQty: number | null;
  slFilledTime: number | null;
  exitReason: ExitReason;
  realizedPnl: number;
  rMultiple: number;
  closedTime: number;
  signal: TradeSignalContext;
  entryOrderId: string;
  slOrderId: string | null;
  tp1OrderId: string | null;
  tp2OrderId: string | null;
}
