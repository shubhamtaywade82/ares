export interface DeltaConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  wsUrl: string;
}

export interface TradingConfig {
  productId: number;
  productSymbol: string;
  positionSize: number;
  profitTargetPercent: number;
  stopLossPercent: number;
  maxOpenPositions: number;
  leverage: number;
  maxDailyLoss: number;
  maxPositionSize: number;
}

export interface StrategyConfig {
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit_order' | 'market_order';
export type OrderState = 'open' | 'pending' | 'closed' | 'cancelled';
export type StopOrderType = 'stop_loss_order';

export interface Order {
  id?: number;
  user_id?: number;
  size: number;
  unfilled_size?: number;
  side: OrderSide;
  order_type: OrderType;
  limit_price?: string;
  stop_order_type?: StopOrderType;
  stop_price?: string;
  paid_commission?: string;
  commission?: string;
  reduce_only?: boolean;
  client_order_id?: string;
  state?: OrderState;
  created_at?: string;
  product_id: number;
  product_symbol?: string;
  post_only?: boolean;
  time_in_force?: 'gtc' | 'ioc' | 'fok';
  mmp?: 'disabled';
}

export interface Position {
  user_id: number;
  size: number;
  entry_price: string;
  margin: string;
  liquidation_price: string;
  bankruptcy_price: string;
  adl_level: number;
  product_id: number;
  product_symbol: string;
  commission: string;
  realized_pnl: string;
  realized_funding: string;
  unrealized_pnl?: string;
}

export interface Ticker {
  close: number;
  high: number;
  low: number;
  mark_price: string;
  open: number;
  product_id: number;
  symbol: string;
  timestamp: number;
  volume: number;
  quotes: {
    best_ask: string;
    best_bid: string;
    ask_size: string;
    bid_size: string;
  };
}

export interface OrderbookLevel {
  price: string;
  size: number;
}

export interface L2Orderbook {
  buy: OrderbookLevel[];
  sell: OrderbookLevel[];
  product_id: number;
  timestamp: number;
}

export interface Trade {
  id: number;
  price: string;
  size: number;
  side: OrderSide;
  timestamp: number;
  product_id: number;
}

export interface WebSocketMessage {
  type: string;
  symbol?: string;
  product_id?: number;
  [key: string]: any;
}

export interface ApiResponse<T> {
  success: boolean;
  result?: T;
  error?: {
    code: string;
    context?: any;
  };
  meta?: {
    after?: string;
    before?: string;
  };
}

export interface SignalData {
  timestamp: number;
  price: number;
  signal: 'buy' | 'sell' | 'neutral';
  strength: number;
  indicators: {
    rsi?: number;
    [key: string]: any;
  };
}
