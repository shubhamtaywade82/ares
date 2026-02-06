import { OrderStore } from "../state/order.store.js";
import { DeltaRestClient } from "../delta/rest.client.js";

export class OcoManager {
  constructor(
    private store: OrderStore,
    private rest: DeltaRestClient,
    private mode: "paper" | "live"
  ) {}

  async onOrderUpdate(orderId: string, status: string) {
    for (const set of this.store.values()) {
      const isTP = set.targetOrderId === orderId;
      const isSL = set.stopOrderId === orderId;

      if (status !== "closed") continue;

      if (isTP && set.stopOrderId) {
        if (this.mode === "live") {
          await this.rest.cancelOrder(set.stopOrderId);
        }
        this.store.remove(set.clientOrderId);
      }

      if (isSL && set.targetOrderId) {
        if (this.mode === "live") {
          await this.rest.cancelOrder(set.targetOrderId);
        }
        this.store.remove(set.clientOrderId);
      }
    }
  }
}
