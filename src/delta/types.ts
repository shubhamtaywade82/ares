export type DeltaSymbol = string;

export type OrderSide = "buy" | "sell";
export type OrderType = "limit" | "market" | "stop_market";

export interface DeltaCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DeltaOrder {
  id: string;
  product_id: number;
  side: OrderSide;
  price: string;
  size: string;
  status: "open" | "closed" | "cancelled" | "rejected";
}

export interface DeltaPosition {
  product_id: number;
  size: string;
  entry_price: string;
  unrealized_pnl: string;
}

export interface DeltaBalance {
  asset: string;
  balance: string;
  available_balance: string;
}
