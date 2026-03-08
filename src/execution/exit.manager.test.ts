import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ExitManager } from "./exit.manager.js";
import { BracketBuilder } from "./bracket.builder.js";
import { TradeJournal } from "./trade.journal.js";
import { calculatePnl, calculateRMultiple } from "./pnl.js";
import { ActivePosition } from "./trade.types.js";

const makePosition = (): ActivePosition => {
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
    slOrderId: "sl-1",
    tp1OrderId: "tp1-1",
    tp2OrderId: "tp2-1",
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
    signal: { htfBias: "LONG", smcScore: 72, rr: 2, reason: "test" },
  };
}

test("TP1: cancels SL, resizes TP2, places BE-SL as stop-limit", async () => {
  const cancels: string[] = [];
  const places: Array<Record<string, unknown>> = [];
  const rest = {
    cancelOrder: async (id: string) => {
      cancels.push(id);
      return { success: true };
    },
    placeOrder: async (payload: Record<string, unknown>) => {
      places.push(payload);
      return { result: { id: `id-${places.length}` } };
    },
    getPositions: async () => ({ result: [{ product_symbol: "BTCUSD", size: 2 }] }),
  } as any;

  const positions = new Map<string, ActivePosition>([["BTCUSD", makePosition()]]);
  const manager = new ExitManager(
    rest,
    new BracketBuilder(rest),
    { write: () => undefined } as unknown as TradeJournal,
    positions,
    { isDailyLossBreached: () => false, recordTrade: () => undefined, activateKillSwitch: () => undefined }
  );

  await manager.onBracketFill("tp1-1", 2, 105);
  const pos = positions.get("BTCUSD")!;
  assert.equal(pos.stage, "OPEN_PARTIAL");
  assert.equal(cancels.includes("sl-1"), true);
  assert.equal(cancels.includes("tp2-1"), true);
  assert.equal(pos.beSlOrderId, "id-2");
  assert.equal(places[1]?.order_type, "stop_limit_order");
  assert.equal(Number(places[1]?.limit_price), 99.8);
});

test("TP2: cancels BE-SL, clears state and writes journal", async () => {
  let writes = 0;
  const rest = {
    cancelOrder: async () => ({ success: true }),
    getPositions: async () => ({ result: [] }),
  } as any;
  const pos = makePosition();
  pos.beSlOrderId = "be-1";
  const positions = new Map<string, ActivePosition>([["BTCUSD", pos]]);
  const manager = new ExitManager(
    rest,
    new BracketBuilder(rest),
    { write: () => void (writes += 1) } as unknown as TradeJournal,
    positions,
    { isDailyLossBreached: () => false, recordTrade: () => undefined, activateKillSwitch: () => undefined }
  );

  await manager.onBracketFill("tp2-1", 2, 110);
  assert.equal(positions.has("BTCUSD"), false);
  assert.equal(writes, 1);
});

test("SL: cancels remaining exits, clears state, checks daily loss and activates kill", async () => {
  let kill = 0;
  const cancels: string[] = [];
  const rest = {
    cancelOrder: async (id: string) => {
      cancels.push(id);
      return { success: true };
    },
    getPositions: async () => ({ result: [] }),
  } as any;
  const positions = new Map<string, ActivePosition>([["BTCUSD", makePosition()]]);
  const manager = new ExitManager(
    rest,
    new BracketBuilder(rest),
    { write: () => undefined } as unknown as TradeJournal,
    positions,
    { isDailyLossBreached: () => true, recordTrade: () => undefined, activateKillSwitch: () => void (kill += 1) }
  );

  await manager.onBracketFill("sl-1", 4, 95);
  assert.equal(cancels.includes("tp1-1"), true);
  assert.equal(cancels.includes("tp2-1"), true);
  assert.equal(positions.has("BTCUSD"), false);
  assert.equal(kill, 1);
});

test("verifyFlat: keeps state OPEN_FULL if exchange still reports non-zero", async () => {
  const rest = {
    cancelOrder: async () => ({ success: true }),
    getPositions: async () => ({ result: [{ product_symbol: "BTCUSD", size: 1 }] }),
  } as any;
  const pos = makePosition();
  const positions = new Map<string, ActivePosition>([["BTCUSD", pos]]);
  const manager = new ExitManager(
    rest,
    new BracketBuilder(rest),
    { write: () => undefined } as unknown as TradeJournal,
    positions,
    { isDailyLossBreached: () => false, recordTrade: () => undefined, activateKillSwitch: () => undefined }
  );

  await manager.onBracketFill("tp2-1", 2, 110);
  assert.equal(pos.stage, "OPEN_FULL");
});

test("canReenter: blocked after close and cleared on explicit reset", async () => {
  const rest = {
    cancelOrder: async () => ({ success: true }),
    getPositions: async () => ({ result: [] }),
  } as any;
  const positions = new Map<string, ActivePosition>([["BTCUSD", makePosition()]]);
  const manager = new ExitManager(
    rest,
    new BracketBuilder(rest),
    { write: () => undefined } as unknown as TradeJournal,
    positions,
    { isDailyLossBreached: () => false, recordTrade: () => undefined, activateKillSwitch: () => undefined }
  );

  await manager.onBracketFill("tp2-1", 2, 110);
  assert.equal(manager.canReenter("BTCUSD"), false);
  manager.clearReentryBlock("BTCUSD");
  assert.equal(manager.canReenter("BTCUSD"), true);
});

test("TP1 with remaining qty = 0 closes as TP2 path", async () => {
  let writes = 0;
  const rest = {
    cancelOrder: async () => ({ success: true }),
    placeOrder: async () => ({ result: { id: "x" } }),
    getPositions: async () => ({ result: [] }),
  } as any;
  const positions = new Map<string, ActivePosition>([["BTCUSD", makePosition()]]);
  const manager = new ExitManager(
    rest,
    new BracketBuilder(rest),
    { write: () => void (writes += 1) } as unknown as TradeJournal,
    positions,
    { isDailyLossBreached: () => false, recordTrade: () => undefined, activateKillSwitch: () => undefined }
  );

  // source-of-truth remaining is zero
  rest.getPositions = async () => ({ result: [] });
  await manager.onBracketFill("tp1-1", 2, 105);
  assert.equal(positions.has("BTCUSD"), false);
  assert.equal(writes, 1);
});

test("NDJSON: all required fields are present in written record", () => {
  const dir = mkdtempSync(join(tmpdir(), "ares-journal-"));
  const journal = new TradeJournal(join(dir, "trades.ndjson"));
  journal.write({
    id: "1",
    symbol: "BTCUSD",
    side: "buy",
    entryPrice: 100,
    entryQty: 1,
    entryTime: 1,
    tp1Price: 105,
    tp1FilledPrice: 105,
    tp1FilledQty: 1,
    tp1FilledTime: 2,
    tp2Price: 110,
    tp2FilledPrice: null,
    tp2FilledQty: null,
    tp2FilledTime: null,
    slPrice: 95,
    slFilledPrice: null,
    slFilledQty: null,
    slFilledTime: null,
    exitReason: "TP1",
    realizedPnl: 5,
    rMultiple: 1,
    closedTime: 3,
    signal: { htfBias: "LONG", smcScore: 70, rr: 2, reason: "A" },
    entryOrderId: "e",
    slOrderId: "s",
    tp1OrderId: "t1",
    tp2OrderId: "t2",
  });

  const ndjson = readFileSync(join(dir, "trades.ndjson"), "utf8").trim();
  const parsed = JSON.parse(ndjson) as Record<string, unknown>;
  const required = [
    "id", "symbol", "side", "entryPrice", "entryQty", "entryTime",
    "tp1Price", "tp1FilledPrice", "tp1FilledQty", "tp1FilledTime",
    "tp2Price", "tp2FilledPrice", "tp2FilledQty", "tp2FilledTime",
    "slPrice", "slFilledPrice", "slFilledQty", "slFilledTime",
    "exitReason", "realizedPnl", "rMultiple", "closedTime", "signal",
    "entryOrderId", "slOrderId", "tp1OrderId", "tp2OrderId",
  ];

  for (const key of required) {
    assert.equal(Object.hasOwn(parsed, key), true);
  }
  assert.equal(parsed.symbol, "BTCUSD");
});

test("R-multiple calculation for win and loss", () => {
  const winPnl = calculatePnl("buy", 100, 110, 2);
  const lossPnl = calculatePnl("buy", 100, 95, 2);
  assert.equal(calculateRMultiple(winPnl, 10), 2);
  assert.equal(calculateRMultiple(lossPnl, 10), -1);
});


test("boot adopt reconstructs active position from reduce-only brackets", async () => {
  const rest = { getPositions: async () => ({ result: [] }) } as any;
  const positions = new Map<string, ActivePosition>();
  const manager = new ExitManager(
    rest,
    new BracketBuilder(rest),
    { write: () => undefined } as unknown as TradeJournal,
    positions,
    { isDailyLossBreached: () => false, recordTrade: () => undefined, activateKillSwitch: () => undefined }
  );

  await manager.reconcileOnBoot(
    [{ product_symbol: "BTCUSD", size: 2, entry_price: 100 }],
    [
      { id: "sl-1", product_symbol: "BTCUSD", reduce_only: true, order_type: "stop_limit_order", stop_price: 95 },
      { id: "tp-1", product_symbol: "BTCUSD", reduce_only: true, order_type: "limit_order", limit_price: 105 },
      { id: "tp-2", product_symbol: "BTCUSD", reduce_only: true, order_type: "limit_order", limit_price: 110 },
    ],
    true,
    async () => undefined
  );

  assert.equal(positions.has("BTCUSD"), true);
  assert.equal(positions.get("BTCUSD")?.stage, "OPEN_FULL");
});

test("boot orphan closes when configured and kills when disabled", async () => {
  const rest = { getPositions: async () => ({ result: [] }) } as any;
  const positions = new Map<string, ActivePosition>();
  let closed = 0;
  let killed = 0;
  const manager = new ExitManager(
    rest,
    new BracketBuilder(rest),
    { write: () => undefined } as unknown as TradeJournal,
    positions,
    {
      isDailyLossBreached: () => false,
      recordTrade: () => undefined,
      activateKillSwitch: () => void (killed += 1),
    }
  );

  await manager.reconcileOnBoot(
    [{ product_symbol: "BTCUSD", size: 1, entry_price: 100 }],
    [],
    true,
    async () => void (closed += 1)
  );
  assert.equal(closed, 1);

  await manager.reconcileOnBoot(
    [{ product_symbol: "ETHUSD", size: 1, entry_price: 100 }],
    [],
    false,
    async () => undefined
  );
  assert.equal(killed, 1);
});


test("Concurrent fill for same symbol is ignored while first fill is in progress", async () => {
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const rest = {
    cancelOrder: async () => {
      await wait;
      return { success: true };
    },
    placeOrder: async () => ({ result: { id: "be-1" } }),
    getPositions: async () => ({ result: [{ product_symbol: "BTCUSD", size: 2 }] }),
  } as any;

  const positions = new Map<string, ActivePosition>([["BTCUSD", makePosition()]]);
  const manager = new ExitManager(
    rest,
    new BracketBuilder(rest),
    { write: () => undefined } as unknown as TradeJournal,
    positions,
    { isDailyLossBreached: () => false, recordTrade: () => undefined, activateKillSwitch: () => undefined }
  );

  const first = manager.onBracketFill("tp1-1", 2, 105);
  const second = manager.onBracketFill("tp2-1", 2, 110);
  release?.();
  await Promise.all([first, second]);

  // second event should be ignored, so position remains partial/open
  assert.equal(positions.has("BTCUSD"), true);
  assert.equal(positions.get("BTCUSD")?.stage, "OPEN_PARTIAL");
});
