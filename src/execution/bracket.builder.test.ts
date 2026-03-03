import test from "node:test";
import assert from "node:assert/strict";

import { BracketBuilder } from "./bracket.builder.js";
import { ActivePosition } from "./trade.types.js";

function pos(): ActivePosition {
  return {
    entryOrderId: "entry-1",
    symbol: "BTCUSD",
    side: "buy",
    entryPrice: 100,
    entryQty: 4,
    filledQty: 4,
    entryTime: 1,
    stage: "OPEN_FULL",
    slPrice: 95,
    tp1Price: 105,
    tp2Price: 110,
    slOrderId: null,
    tp1OrderId: null,
    tp2OrderId: null,
    beSlOrderId: null,
    tp1FillPrice: null,
    tp1FillQty: null,
    tp1FilledTime: null,
    tp2FillPrice: null,
    tp2FillQty: null,
    tp2FilledTime: null,
    slFillPrice: null,
    slFillQty: null,
    slFilledTime: null,
    signal: { htfBias: "LONG", smcScore: 70, rr: 2, reason: "test" },
  };
}

test("placeInitialBrackets rolls back placed orders on partial failure", async () => {
  const cancelled: string[] = [];
  let call = 0;
  const rest = {
    placeOrder: async () => {
      call += 1;
      if (call === 2) throw new Error("tp1 failed");
      return { result: { id: `id-${call}` } };
    },
    cancelOrder: async (id: string) => {
      cancelled.push(id);
      return { success: true };
    },
  } as any;

  const builder = new BracketBuilder(rest);
  await assert.rejects(() => builder.placeInitialBrackets(pos()));
  assert.equal(cancelled.includes("id-1"), true);
  assert.equal(cancelled.includes("id-3"), true);
});

test("placeBreakevenSl uses stop-limit with 0.2% offset", async () => {
  const payloads: Array<Record<string, unknown>> = [];
  const rest = {
    placeOrder: async (payload: Record<string, unknown>) => {
      payloads.push(payload);
      return { result: { id: "be-1" } };
    },
  } as any;

  const builder = new BracketBuilder(rest);
  const id = await builder.placeBreakevenSl(pos(), 2);
  assert.equal(id, "be-1");
  assert.equal(payloads[0]?.order_type, "stop_limit_order");
  assert.equal(Number(payloads[0]?.stop_price), 100);
  assert.equal(Number(payloads[0]?.limit_price), 99.8);
});
