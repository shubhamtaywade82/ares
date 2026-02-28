export type DeltaSymbol = string;

// Delta API order_type values — docs: limit_order, market_order, stop_loss_order, take_profit_order
export type OrderSide = "buy" | "sell";
export type OrderType = "limit_order" | "market_order" | "stop_loss_order" | "take_profit_order";

export interface DeltaCandle {
  timestamp: number; // milliseconds (normalized from REST `time` field which is seconds)
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
  limit_price: string; // docs use limit_price, not price
  size: string;
  status: "open" | "closed" | "cancelled" | "rejected";
}

export interface DeltaPosition {
  product_id: number;
  size: string;     // positive = long, negative = short per docs
  entry_price: string;
  unrealized_pnl: string;
}

export interface DeltaBalance {
  asset_symbol: string;  // docs: asset_symbol, not asset
  balance: string;
  available_balance: string;
}
