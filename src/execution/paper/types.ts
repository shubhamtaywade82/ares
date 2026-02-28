export type PaperOrderType = "limit" | "market" | "stop_market";
export type PaperOrderState = "open" | "pending" | "closed" | "cancelled";

export interface PaperOrder {
  id: string;
  clientOrderId?: string | undefined;
  productId?: number | undefined;
  productSymbol?: string | undefined;
  role?: "entry" | "stop" | "take_profit" | undefined;
  type: PaperOrderType;
  side: "buy" | "sell";
  price?: number | undefined;
  stopPrice?: number | undefined;
  qty: number;
  filledQty: number;
  status: PaperOrderState;
  createdAt: number;
}
