# Changelog

## Unreleased

### feat
- Added stricter liquidity sweep handling in SMC: closed-candle processing guard, bar-based sweep expiry, capped sweep history, and sweep volume metadata.
- Added LTF sweep confluence gates (price proximity + volume confirmation) to reduce chop-market false positives.
- Enriched AI veto SMC context with nearest bullish/bearish OB/FVG levels and distance percentages.
- Added bar-based sweep freshness (8 closed bars), plus richer active sweep metrics (age minutes + volume ratio) in AI veto context.
- Added stale-zone filtering for nearest OB/FVG lookups and setup-score ceiling clamp (`Math.min(score, 100)`).
- Switched to timestamp-derived bar indices for restart-safe staleness/expiry behavior.
- Added SMC unit tests for restart-safe bar indexing, sweep expiry, live idempotency, and seed-bypass behavior.
- Added timestamp normalization guard in SMC update path (supports seconds or milliseconds input).
- Added live boot position reconciliation and optional kill-switch blocking via `BOOT_BLOCK_ON_ORPHAN_POSITIONS`.
- Added live pending-entry guard and WebSocket reconnect reseed to reduce duplicate entry risk after disconnects.
- Added pending-entry timeout expiry (15m) with best-effort order cancellation for stale live entries.
- Added open-order reconciliation on boot and hardened stale pending cancel error handling (retain pending state on transient cancel failures).
- Added periodic (60s) pending-entry expiry checks in live mode and ignored reduce-only open orders during boot pending reconciliation.
- Added kill-switch cleanup hooks to attempt cancel-all-orders and close-all-positions, plus margin and post-only entry guards.
- Added explicit partial-fill order logging and surfaced post-only rejection details; close-all-positions now raises on failed close attempts.
- Implemented live partial-fill bracket rebalancing so SL/TP sizes follow `filled_qty` (not original order size).
- Hardened partial-fill rebalancing: ignore stale fill updates and skip rebracketing when prior SL/TP cancel fails with transient errors.
- Ensured full-fill updates backfill bracket sizing by re-running rebalance to final `filled_qty` when prior partial rebalance was skipped.
- Added boot-time `DELTA_PRODUCT_ID` verification against Delta product metadata to prevent silent wrong-product execution.
- Added midnight reset scheduling for paper daily PnL baseline so daily loss guard is day-scoped.
- Added debug-level raw WS payload logs (`[ARES.WS.RAW]`) for order/position schema and state-string verification on testnet.
- Updated daily PnL reset scheduling to align with IST midnight (`Asia/Kolkata`) for India-session risk boundaries.

