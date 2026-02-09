export type ExecutionSide = "LONG" | "SHORT";

export interface ExecutionRequest {
  symbol: string;
  side: ExecutionSide;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  qty: number;
  useMarketEntry?: boolean;
}

export interface ActiveOrderSet {
  entryOrderId?: string;
  stopOrderId?: string;
  targetOrderId?: string;
  clientOrderId: string;
}
