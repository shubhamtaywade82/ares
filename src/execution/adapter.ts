/**
 * ExecutionAdapter — unified interface for all three ARES execution modes.
 *
 * Strategy and risk code interact exclusively through this interface.
 * The concrete implementation (Backtest / Paper / Live) is injected at startup
 * based on the configured EngineMode.
 *
 * All methods are async so live adapters can await REST calls while backtest
 * and paper adapters resolve synchronously via Promise.resolve().
 */

// ── Shared order / position types ─────────────────────────────────────────────

/** Raw order request passed from strategy/risk to the execution layer. */
export interface Order {
  /** Product symbol (e.g. "ETHUSD"). */
  symbol: string;
  /** Delta Exchange numeric product ID (optional — symbol is sufficient). */
  productId?: number | undefined;
  /** Trade direction. */
  side: "buy" | "sell";
  /** Order type. */
  type: "market" | "limit" | "stop_market";
  /** Limit price — required for "limit" orders. */
  price?: number | undefined;
  /** Stop trigger price — required for "stop_market" orders. */
  stopPrice?: number | undefined;
  /** Number of contracts. */
  qty: number;
  /** Optional idempotency key / client order ID. */
  clientOrderId?: string | undefined;
  /** If true, the order must reduce an existing position. */
  reduceOnly?: boolean | undefined;
}

/** Result returned after an order is processed. */
export interface OrderResult {
  /** Exchange or simulated order identifier. */
  orderId: string;
  /** Current order state. */
  status: "open" | "filled" | "cancelled" | "rejected";
  /** Fill price (set when status is "filled"). */
  fillPrice?: number | undefined;
  /** Filled quantity (may differ from requested qty on partial fills). */
  fillQty?: number | undefined;
  /** Fee charged for this fill in INR (simulated or exchange-reported). */
  feeInr?: number | undefined;
}

/** A position as returned by getPositions(). */
export interface AdapterPosition {
  /** Product symbol (e.g. "ETHUSD"). */
  symbol: string;
  /** Delta Exchange numeric product ID, if known. */
  productId?: number | undefined;
  /** Position direction. */
  side: "LONG" | "SHORT";
  /** Number of open contracts. */
  qty: number;
  /** Average entry price in USD. */
  entryPrice: number;
  /** Current mark price in USD (if available). */
  markPrice?: number | undefined;
}

// ── Interface ──────────────────────────────────────────────────────────────────

/**
 * Minimal contract every execution adapter must satisfy.
 *
 * Implementations:
 *   - BacktestExecutor   — deterministic fills from historical candles
 *   - PaperAdapter       — live feed, simulated fills + fees
 *   - LiveAdapter        — live feed, real Delta Exchange REST calls
 */
export interface ExecutionAdapter {
  /**
   * Place a new order.
   *
   * In Backtest and Paper modes this resolves immediately with a simulated
   * fill. In Live mode it awaits the Delta Exchange REST response.
   */
  placeOrder(order: Order): Promise<OrderResult>;

  /**
   * Cancel an open order by its exchange / simulated order ID.
   *
   * Silently succeeds if the order is already filled or does not exist.
   */
  cancelOrder(orderId: string): Promise<void>;

  /**
   * Return all currently open positions.
   *
   * In Backtest and Paper modes this reads from in-memory state.
   * In Live mode it queries the Delta Exchange REST API.
   */
  getPositions(): Promise<AdapterPosition[]>;
}
