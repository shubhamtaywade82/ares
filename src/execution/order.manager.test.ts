import test from "node:test";
import assert from "node:assert/strict";

import { OrderManager } from "./order.manager.js";
import { OrderStore } from "../state/order.store.js";
import { BracketBuilder } from "./bracket.builder.js";
import { ActivePosition } from "./trade.types.js";

test("OrderManager onLiveEntryFilled places stop-limit SL + TP1 + TP2", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const rest = {
    placeOrder: async (payload: Record<string, unknown>) => {
      calls.push(payload);
      return { result: { id: `id-${calls.length}` } };
    },
    getPositions: async () => ({ result: [] }),
  } as any;

  const store = new OrderStore();
  const activePositions = new Map<string, ActivePosition>();
  const builder = new BracketBuilder(rest);
  const manager = new OrderManager(rest, store, "live", undefined, builder, activePositions);

  const set = store.create("cid");
  set.entryOrderId = "entry-1";
  set.symbol = "BTCUSD";
  set.side = "LONG";
  set.stopPrice = 99;
  set.targetPrice = 105;

  await manager.onLiveEntryFilled("entry-1", 4, 100);

  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.order_type, "stop_limit_order");
  assert.equal(activePositions.get("BTCUSD")?.tp1OrderId, "id-2");
  assert.equal(activePositions.get("BTCUSD")?.tp2OrderId, "id-3");
  assert.equal(activePositions.get("BTCUSD")?.slOrderId, "id-1");
});
