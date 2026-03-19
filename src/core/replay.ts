import { readEvents } from "./event.store.js";
import { eventBus } from "../market/event.bus.js";

/**
 * Replay all stored events from logs/events.ndjson through the live event bus.
 *
 * Useful for:
 *   - Debugging: reproduce exact sequence of events that led to a trade
 *   - Backtesting: re-run strategy over historical data
 *   - Audit: verify state rebuilds deterministically
 *
 * NOTE: Call this before starting the live WS feed to avoid interleaving.
 */
export const replayEvents = async (): Promise<void> => {
  const events = await readEvents();
  console.log(`[ARES.REPLAY] Replaying ${events.length} stored events`);

  for (const e of events) {
    // Re-emit without re-persisting (suppressPersist = true)
    eventBus.emitRaw(e.type, e.payload, true);
  }

  console.log("[ARES.REPLAY] Done");
};
