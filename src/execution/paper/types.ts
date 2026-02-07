export type PaperOrderType = "limit" | "market" | "stop_market";
export type PaperOrderState = "open" | "pending" | "closed" | "cancelled";

export interface PaperOrder {
  id: string;
  clientOrderId?: string;
  productId?: number;
  productSymbol?: string;
  role?: "entry" | "stop" | "take_profit";
  type: PaperOrderType;
  side: "buy" | "sell";
  price?: number;
  stopPrice?: number;
  qty: number;
  filledQty: number;
  status: PaperOrderState;
  createdAt: number;
}
