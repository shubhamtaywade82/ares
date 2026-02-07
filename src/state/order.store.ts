import { ActiveOrderSet } from "../execution/types.js";

export class OrderStore {
  private orders = new Map<string, ActiveOrderSet>();

  create(clientOrderId: string): ActiveOrderSet {
    const set: ActiveOrderSet = { clientOrderId };
    this.orders.set(clientOrderId, set);
    return set;
  }

  get(clientOrderId: string): ActiveOrderSet | undefined {
    return this.orders.get(clientOrderId);
  }

  remove(clientOrderId: string) {
    this.orders.delete(clientOrderId);
  }

  values(): IterableIterator<ActiveOrderSet> {
    return this.orders.values();
  }
}
