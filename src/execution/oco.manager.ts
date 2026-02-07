import { OrderStore } from "../state/order.store.js";
import { DeltaRestClient } from "../delta/rest.client.js";
import { PaperExecutor } from "./paper.executor.js";

export class OcoManager {
  constructor(
    private store: OrderStore,
    private rest: DeltaRestClient,
    private mode: "paper" | "live",
    private paper?: PaperExecutor
  ) {}

  async onOrderUpdate(orderId: string, status: string) {
    for (const set of this.store.values()) {
      const isTP = set.targetOrderId === orderId;
      const isSL = set.stopOrderId === orderId;

      if (status !== "closed") continue;

      if (isTP && set.stopOrderId) {
        if (this.mode === "live") {
          await this.rest.cancelOrder(set.stopOrderId);
        } else if (this.paper) {
          this.paper.cancel(set.stopOrderId);
        }
        this.store.remove(set.clientOrderId);
      }

      if (isSL && set.targetOrderId) {
        if (this.mode === "live") {
          await this.rest.cancelOrder(set.targetOrderId);
        } else if (this.paper) {
          this.paper.cancel(set.targetOrderId);
        }
        this.store.remove(set.clientOrderId);
      }
    }
  }
}
