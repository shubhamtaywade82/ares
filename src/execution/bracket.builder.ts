import { DeltaRestClient } from "../delta/rest.client.js";
import { logger } from "../utils/logger.js";
import { ActivePosition } from "./trade.types.js";

const SL_LIMIT_OFFSET = 0.002;

type PlacedBracketIds = { slOrderId: string; tp1OrderId: string; tp2OrderId: string };

export class BracketBuilder {
  constructor(private delta: DeltaRestClient) {}

  async placeInitialBrackets(pos: ActivePosition): Promise<PlacedBracketIds> {
    const exitSide = pos.side === "buy" ? "sell" : "buy";
    const halfQty = Math.floor(pos.filledQty / 2);
    const rem = pos.filledQty - halfQty;
    const slLimit =
      pos.side === "buy"
        ? pos.slPrice * (1 - SL_LIMIT_OFFSET)
        : pos.slPrice * (1 + SL_LIMIT_OFFSET);

    const results = await Promise.allSettled([
      this.delta.placeOrder({
        product_symbol: pos.symbol,
        size: pos.filledQty,
        side: exitSide,
        order_type: "stop_limit_order",
        stop_price: String(pos.slPrice),
        limit_price: String(slLimit),
        reduce_only: true,
      }),
      this.delta.placeOrder({
        product_symbol: pos.symbol,
        size: halfQty,
        side: exitSide,
        order_type: "limit_order",
        limit_price: String(pos.tp1Price),
        reduce_only: true,
      }),
      this.delta.placeOrder({
        product_symbol: pos.symbol,
        size: rem,
        side: exitSide,
        order_type: "limit_order",
        limit_price: String(pos.tp2Price),
        reduce_only: true,
      }),
    ]);

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      const placedIds = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<{ result?: { id?: string } }>).value?.result?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      if (placedIds.length > 0) {
        const rollbackResults = await Promise.allSettled(
          placedIds.map((id) => this.delta.cancelOrder(id))
        );
        rollbackResults.forEach((result, idx) => {
          if (result.status === "rejected") {
            logger.error(
              `[ARES.EXECUTION] Rollback cancel failed for ${placedIds[idx]}: ${String(result.reason)}`
            );
          }
        });
        logger.error(`[ARES.EXECUTION] Bracket rollback — cancelled ${placedIds.length} order(s)`);
      }

      throw new Error(`Bracket placement failed with ${failed.length} rejected order(s)`);
    }

    const [sl, tp1, tp2] = results as [
      PromiseFulfilledResult<{ result: { id: string } }>,
      PromiseFulfilledResult<{ result: { id: string } }>,
      PromiseFulfilledResult<{ result: { id: string } }>
    ];

    return {
      slOrderId: String(sl.value.result.id),
      tp1OrderId: String(tp1.value.result.id),
      tp2OrderId: String(tp2.value.result.id),
    };
  }

  async placeBreakevenSl(pos: ActivePosition, remainingQty: number): Promise<string> {
    const exitSide = pos.side === "buy" ? "sell" : "buy";
    const beSlLimit =
      pos.side === "buy"
        ? pos.entryPrice * (1 - SL_LIMIT_OFFSET)
        : pos.entryPrice * (1 + SL_LIMIT_OFFSET);

    const order = await this.delta.placeOrder({
      product_symbol: pos.symbol,
      size: remainingQty,
      side: exitSide,
      order_type: "stop_limit_order",
      stop_price: String(pos.entryPrice),
      limit_price: String(beSlLimit),
      reduce_only: true,
    });
    return String(order.result.id);
  }

  async fetchRemainingQty(symbol: string): Promise<number> {
    const positionsRes = await this.delta.getPositions();
    const positions = Array.isArray(positionsRes?.result) ? positionsRes.result : [];
    const pos = positions.find(
      (item: Record<string, unknown>) =>
        String(item.product_symbol ?? item.symbol ?? "").toUpperCase() === symbol.toUpperCase()
    );
    if (!pos) return 0;
    return Math.abs(Number(pos.size ?? 0));
  }
}
