import { v4 as uuid } from "uuid";
import { DeltaRestClient } from "../delta/rest.client.js";
import { ExecutionRequest } from "./types.js";
import { OrderStore } from "../state/order.store.js";

export class OrderManager {
  constructor(
    private rest: DeltaRestClient,
    private store: OrderStore,
    private mode: "paper" | "live"
  ) {}

  async execute(req: ExecutionRequest) {
    const clientOrderId = uuid();
    const set = this.store.create(clientOrderId);

    if (this.mode === "paper") {
      console.log("[PAPER] Entry filled", req);
      return set;
    }

    const entry = await this.rest.placeOrder({
      product_symbol: req.symbol,
      side: req.side === "LONG" ? "buy" : "sell",
      type: "limit",
      price: req.entryPrice,
      size: req.qty,
      client_order_id: clientOrderId,
    });

    set.entryOrderId = entry.result.id;

    const stop = await this.rest.placeOrder({
      product_symbol: req.symbol,
      side: req.side === "LONG" ? "sell" : "buy",
      type: "stop_market",
      stop_price: req.stopPrice,
      size: req.qty,
      reduce_only: true,
      client_order_id: `${clientOrderId}-SL`,
    });

    set.stopOrderId = stop.result.id;

    const tp = await this.rest.placeOrder({
      product_symbol: req.symbol,
      side: req.side === "LONG" ? "sell" : "buy",
      type: "limit",
      price: req.targetPrice,
      size: req.qty,
      reduce_only: true,
      client_order_id: `${clientOrderId}-TP`,
    });

    set.targetOrderId = tp.result.id;

    return set;
  }
}
