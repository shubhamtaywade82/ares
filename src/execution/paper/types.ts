export type PaperOrderType = "limit" | "stop_market";

export interface PaperOrder {
  id: string;
  type: PaperOrderType;
  side: "buy" | "sell";
  price?: number;
  stopPrice?: number;
  qty: number;
  filledQty: number;
  status: "open" | "filled" | "cancelled";
}
