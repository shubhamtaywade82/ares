/**
 * Live Execution Adapter — places real orders on Delta Exchange India via REST.
 *
 * Strategy and risk code call the same ExecutionAdapter interface as in paper
 * and backtest modes. Only this adapter touches the actual exchange.
 *
 * Fees are paid to the exchange; we do not simulate them here. The fee engine
 * in src/finance/feeEngine.ts can still be used for pre-trade cost estimation.
 */

import { DeltaRestClient } from "../delta/rest.client.js";
import type {
  ExecutionAdapter,
  Order,
  OrderResult,
  AdapterPosition,
} from "./adapter.js";

export class LiveAdapter implements ExecutionAdapter {
  constructor(private readonly rest: DeltaRestClient) {}

  async placeOrder(order: Order): Promise<OrderResult> {
    const response = await this.rest.placeOrder({
      ...(order.productId !== undefined ? { product_id: order.productId } : {}),
      product_symbol: order.symbol,
      size: order.qty,
      side: order.side,
      order_type: order.type,
      ...(order.price !== undefined ? { limit_price: String(order.price) } : {}),
      ...(order.stopPrice !== undefined
        ? { stop_price: String(order.stopPrice) }
        : {}),
      ...(order.clientOrderId !== undefined
        ? { client_order_id: order.clientOrderId }
        : {}),
      ...(order.reduceOnly !== undefined ? { reduce_only: order.reduceOnly } : {}),
    });

    const result = response.result as {
      id?: string | undefined;
      state?: string | undefined;
      avg_fill_price?: string | number | undefined;
      size?: number | undefined;
    };

    const status: OrderResult["status"] =
      result.state === "filled"
        ? "filled"
        : result.state === "cancelled"
        ? "cancelled"
        : result.state === "rejected"
        ? "rejected"
        : "open";

    return {
      orderId: result.id ?? "",
      status,
      ...(result.avg_fill_price !== undefined
        ? { fillPrice: Number(result.avg_fill_price) }
        : {}),
      ...(result.size !== undefined ? { fillQty: result.size } : {}),
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.rest.cancelOrder(orderId);
  }

  async getPositions(): Promise<AdapterPosition[]> {
    const response = await this.rest.getPositions();
    const raw = response.result as Array<{
      product_symbol?: string | undefined;
      product_id?: number | undefined;
      size?: number | string | undefined;
      entry_price?: string | number | undefined;
      mark_price?: string | number | undefined;
    }>;

    const results: AdapterPosition[] = [];
    for (const pos of raw) {
      const size = Number(pos.size ?? 0);
      if (!Number.isFinite(size) || size === 0) continue;
      results.push({
        symbol: pos.product_symbol ?? "",
        ...(pos.product_id !== undefined ? { productId: pos.product_id } : {}),
        side: size > 0 ? "LONG" : "SHORT",
        qty: Math.abs(size),
        entryPrice: Number(pos.entry_price ?? 0),
        markPrice: Number(pos.mark_price ?? 0),
      });
    }
    return results;
  }
}
