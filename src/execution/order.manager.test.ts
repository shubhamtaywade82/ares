import test from "node:test";
import assert from "node:assert/strict";

import { OrderManager } from "./order.manager.js";
import { OrderStore } from "../state/order.store.js";

function makeManager(restOverrides: Partial<any> = {}) {
  const calls: Array<{ type: string; payload?: any; id?: string }> = [];
  const rest = {
    cancelOrder: async (id: string) => {
      calls.push({ type: "cancel", id });
      return { success: true };
    },
    placeOrder: async (payload: any) => {
      calls.push({ type: "place", payload });
      return { result: { id: payload.client_order_id } };
    },
    ...restOverrides,
  } as any;

  const store = new OrderStore();
  const manager = new OrderManager(rest, store, "live");
  const set = store.create("cid");
  set.entryOrderId = "entry-1";
  set.stopOrderId = "stop-1";
  set.targetOrderId = "tp-1";
  set.symbol = "BTCUSD";
  set.side = "LONG";
  set.stopPrice = 99;
  set.targetPrice = 105;
  set.bracketQty = 5;
  set.filledQty = 0;

  return { manager, set, calls };
}

test("OrderManager rebalances live brackets to filled quantity on partial fill", async () => {
  const { manager, set, calls } = makeManager();

  await manager.onLiveEntryPartialFill("entry-1", 3);

  assert.equal(calls.filter((c) => c.type === "cancel").length, 2);
  const places = calls.filter((c) => c.type === "place");
  assert.equal(places.length, 2);
  assert.equal(Number(places[0]?.payload?.size), 3);
  assert.equal(Number(places[1]?.payload?.size), 3);
  assert.equal(set.bracketQty, 3);
  assert.equal(set.filledQty, 3);
});

test("OrderManager skips rebalance when cancel fails with non-terminal error", async () => {
  const { manager, calls } = makeManager({
    cancelOrder: async (_id: string) => {
      throw new Error("network timeout");
    },
  });

  await manager.onLiveEntryPartialFill("entry-1", 3);

  assert.equal(calls.filter((c) => c.type === "place").length, 0);
});

test("OrderManager rebalances short entries with buy-side reduce-only exits", async () => {
  const { manager, set, calls } = makeManager();
  set.side = "SHORT";

  await manager.onLiveEntryPartialFill("entry-1", 2);

  const places = calls.filter((c) => c.type === "place");
  assert.equal(places.length, 2);
  assert.equal(places[0]?.payload?.side, "buy");
  assert.equal(places[1]?.payload?.side, "buy");
});

test("OrderManager ignores stale or duplicate fill quantities", async () => {
  const { manager, calls, set } = makeManager();

  await manager.onLiveEntryPartialFill("entry-1", 3);
  await manager.onLiveEntryPartialFill("entry-1", 2);
  await manager.onLiveEntryPartialFill("entry-1", 3);

  assert.equal(calls.filter((c) => c.type === "place").length, 2);
  assert.equal(set.filledQty, 3);
});

test("OrderManager onLiveEntryFilled rebalances to final fill after a skipped partial", async () => {
  let shouldFailCancel = true;
  const { manager, calls, set } = makeManager({
    cancelOrder: async (id: string) => {
      if (shouldFailCancel) throw new Error("network timeout");
      calls.push({ type: "cancel", id });
      return { success: true };
    },
  });

  await manager.onLiveEntryPartialFill("entry-1", 3);
  shouldFailCancel = false;
  await manager.onLiveEntryFilled("entry-1", 5);

  const places = calls.filter((c) => c.type === "place");
  assert.equal(places.length, 2);
  assert.equal(Number(places[0]?.payload?.size), 5);
  assert.equal(Number(places[1]?.payload?.size), 5);
  assert.equal(set.filledQty, 5);
  assert.equal(set.bracketQty, 5);
});

test("OrderManager onLiveEntryFilled does not double-rebalance at same final fill", async () => {
  const { manager, calls } = makeManager();

  await manager.onLiveEntryPartialFill("entry-1", 3);
  await manager.onLiveEntryFilled("entry-1", 3);

  assert.equal(calls.filter((c) => c.type === "place").length, 2);
});
