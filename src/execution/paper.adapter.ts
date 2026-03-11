/**
 * Paper Execution Adapter — adapts PaperExecutor to the unified ExecutionAdapter
 * interface.
 *
 * Uses the live WebSocket market feed with fully simulated order fills.
 * Fees, slippage, funding, and liquidation penalties are all simulated by the
 * underlying PaperExecutor (which reads from PAPER_CONFIG).
 *
 * This thin wrapper exists so strategy / risk code can call the same
 * ExecutionAdapter interface regardless of which mode is active.
 */

import { v4 as uuid } from "uuid";
import { PaperExecutor } from "./paper.executor.js";
import type {
  ExecutionAdapter,
  Order,
  OrderResult,
  AdapterPosition,
} from "./adapter.js";

export class PaperAdapter implements ExecutionAdapter {
  constructor(private readonly paper: PaperExecutor) {}

  async placeOrder(order: Order): Promise<OrderResult> {
    const placed = this.paper.placeOrder({
      ...(order.productId !== undefined ? { product_id: order.productId } : {}),
      product_symbol: order.symbol,
      size: order.qty,
      side: order.side,
      order_type: order.type,
      ...(order.price !== undefined ? { limit_price: order.price } : {}),
      ...(order.stopPrice !== undefined ? { stop_price: order.stopPrice } : {}),
      client_order_id: order.clientOrderId ?? uuid(),
      ...(order.reduceOnly !== undefined ? { reduce_only: order.reduceOnly } : {}),
    });

    const status: OrderResult["status"] =
      placed.status === "closed"
        ? "filled"
        : placed.status === "cancelled"
        ? "cancelled"
        : "open";

    return {
      orderId: placed.id,
      status,
      ...(placed.filledQty > 0
        ? {
            fillPrice: placed.price,
            fillQty: placed.filledQty,
          }
        : {}),
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    this.paper.cancel(orderId);
  }

  async getPositions(): Promise<AdapterPosition[]> {
    return this.paper.getOpenPositions().map((pos) => ({
      symbol: pos.productSymbol ?? String(pos.productId ?? ""),
      ...(pos.productId !== undefined ? { productId: pos.productId } : {}),
      side: pos.side,
      qty: pos.qty,
      entryPrice: pos.entryPrice,
    }));
  }
}
