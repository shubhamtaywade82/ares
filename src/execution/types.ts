export type ExecutionSide = "LONG" | "SHORT";

export interface ExecutionRequest {
  symbol: string;
  productId?: number;
  side: ExecutionSide;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  qty: number;
  useMarketEntry?: boolean;
  signalContext?: {
    htfBias: string;
    smcScore: number;
    rr: number;
    reason: string;
  };
}

export interface ActiveOrderSet {
  entryOrderId?: string;
  stopOrderId?: string;
  targetOrderId?: string;
  clientOrderId: string;
  symbol?: string;
  side?: ExecutionSide;
  stopPrice?: number;
  targetPrice?: number;
  bracketQty?: number;
  filledQty?: number;
  signalContext?: {
    htfBias: string;
    smcScore: number;
    rr: number;
    reason: string;
  };
}


export * from "./trade.types.js";
