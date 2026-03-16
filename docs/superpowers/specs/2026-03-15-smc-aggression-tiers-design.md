# SMC Aggressiveness Tiers + Missing Components + Dashboard UI

**Date:** 2026-03-15
**Status:** Approved

## Problem

The current SMC engine requires a full institutional sequence (sweep → displacement with all 7 conditions → FVG/OB mitigation) to generate entries. This is correct for conservative trading but produces very few trades, especially in lower-volatility crypto pairs. Users need configurable aggressiveness levels so the engine can trade more frequently when desired, while still offering strict mode for safety.

Additionally, three SMC components are missing: breaker blocks, inducement, and premium/discount zones.

## Design Decisions

- **Approach:** Tier as a strategy filter (Approach 1). SMC analyzers always detect everything. A thin tier filter controls what combination is "enough" for an entry.
- **Tier names:** `aggressive` / `moderate` / `conservative`
- **Selection:** Environment variable default (`SMC_AGGRESSION`) + runtime toggle via dashboard UI (POST API)
- **Missing components:** All 3 implemented (breaker blocks, inducement, premium/discount zones)
- **Dashboard:** Tier selector in header, per-symbol readiness checklist, readiness meter showing all 3 tiers, new SMC columns for breakers/inducement/premium-discount

## 1. Aggressiveness Tier System

### 1.1 Tier Definitions

Each tier defines which SMC conditions must be true before an entry is allowed:

| Condition | Aggressive | Moderate | Conservative |
|-----------|-----------|----------|-------------|
| HTF Bias aligned | Required | Required | Required |
| Price in OB or FVG zone (OR logic) | Required | Required | Required |
| Liquidity sweep detected | - | Required | Required |
| Displacement (strict: all 7 conditions) | - | - | Required |
| BOS confirmed | - | Required | Required |
| Breaker block confluence | Bonus (+2) | Bonus (+2) | Required |
| Inducement detected | Bonus (+1) | Bonus (+1) | Bonus (+2) |
| Premium/Discount zone aligned | Bonus (+2) | Bonus (+2) | Required |

**"Required"** = must be true or no entry. **"Bonus (+N)"** = adds N points to score but not mandatory. **"-"** = ignored for this tier.

**OB/FVG condition:** Uses OR logic — `inObZone || inFvgZone`. Price touching either an unmitigated Order Block or an unfilled FVG satisfies this condition. Both being true does not give extra points at the gate level (but the existing scoring in `setup.ltf.ts` still awards +3 for each independently).

**Displacement:** No partial displacement concept. The existing `DisplacementDetector` is all-or-nothing (all 7 conditions). For Aggressive and Moderate tiers, displacement is not required but still adds +4 to score when detected (existing behavior in `setup.ltf.ts`).

**Premium/Discount alignment:** LONG entries require DISCOUNT zone, SHORT entries require PREMIUM zone. If the zone is EQUILIBRIUM (price within 2% of equilibrium midpoint), it is treated as NOT aligned — this forces Conservative entries to wait for price to move into a clear discount/premium area. For Bonus tiers, EQUILIBRIUM counts as not met (no bonus points added).

### 1.2 Score Thresholds

| Tier | Min Score |
|------|----------|
| Aggressive | 3 |
| Moderate | 5 (current default) |
| Conservative | 8 |

**Worked example — Conservative LONG entry reaching score 8+:**
- Price action engulfing bull: +4 (existing)
- In bullish OB: +3 (existing)
- In bullish FVG: +3 (existing)
- Sweep bear trap confirmed: +2 (existing)
- Displacement trigger: +4 (existing)
- In pullback zone: +3 (existing)
- Breaker confluence: +2 (new bonus)
- Premium/Discount aligned (discount): +2 (new bonus)
- Inducement detected: +2 (new bonus)
- HTF trend strength: +3 (existing scorer.ts)
- ATR healthy: +1 (existing scorer.ts)
- **Total possible: 29.** Conservative threshold of 8 is easily reachable when the Required gate conditions are met.

**Note on `PAPER_BYPASS_SCORE`:** The existing `PAPER_BYPASS_SCORE=true` env variable bypasses score thresholds entirely. When set, it overrides tier-aware score thresholds (the tier gate filter still applies — only the minimum score check is skipped). Users who want relaxed entries in paper mode should prefer setting `SMC_AGGRESSION=aggressive` instead. `PAPER_BYPASS_SCORE` remains for backward compatibility but may be deprecated in a future version.

### 1.3 Tier Filter Module

New file: `src/strategy/tier.filter.ts`

Exports:
- `AggressionTier` type: `"aggressive" | "moderate" | "conservative"`
- `TierConditionName` type: string union of all condition names
- `TierReadinessResult` interface: `{ passed: boolean, met: TierConditionName[], unmet: TierConditionName[], readiness: Record<AggressionTier, number> }`
- `evaluateTierReadiness(tier: AggressionTier, state: SmcStateSnapshot): TierReadinessResult`

`SmcStateSnapshot` is a plain object aggregating current SMC state:
```typescript
interface SmcStateSnapshot {
  htfBiasAligned: boolean;
  inObZone: boolean;
  inFvgZone: boolean;
  sweepDetected: boolean;
  displacementDetected: boolean;
  bosConfirmed: boolean;
  breakerConfluence: boolean;
  inducementDetected: boolean;
  premiumDiscountAligned: boolean;
  /** Full premium/discount data for dashboard display (zone, percentile). */
  premiumDiscount: PremiumDiscount | null;
}
```

**Gate condition mapping:** The "Price in OB or FVG zone" gate uses `inObZone || inFvgZone` (OR logic). All other conditions map 1:1 to their boolean field.

The function checks each condition against the tier's requirements and returns pass/fail plus a per-tier readiness percentage (conditions met / conditions required).

### 1.4 Runtime Config

New file: `src/config/runtime.ts`

Holds mutable runtime config initialized from environment defaults:
- `getRuntimeTier(): AggressionTier`
- `setRuntimeTier(tier: AggressionTier): void`
- `getRuntimeConfig(): { tier: AggressionTier }`

Single in-memory variable, no persistence needed (reverts to env default on restart).

### 1.5 API Endpoints

Added to `main.ts` HTTP server:

- `GET /api/config/tier` — returns `{ tier: "moderate" }`
- `POST /api/config/tier?level=aggressive` — validates and sets runtime tier, returns `{ tier: "aggressive" }`

### 1.6 Strategy Runner Integration

The `SmcStateSnapshot` is built in `main.ts` inside `scanSymbol()`, **after** `structure.update()` and `smc.update()` have run (lines 707-715). This ensures all analyzer state is current before the snapshot is assembled. The snapshot is then passed to `runStrategy()` as a new parameter.

`strategy.runner.ts` changes to:
1. `computeHTFBias()`
2. `evaluateTierReadiness(currentTier, snapshot)` — snapshot built by caller (`main.ts`), if not passed → return null
3. `detectLTFSetup()` — existing scoring, plus new bonus points for breaker/inducement/premium-discount
4. `scoreSetup()` — min threshold from tier config
5. Return scored setup

The tier filter runs before LTF setup detection. In aggressive mode, even without a sweep or displacement, if price is in an OB/FVG zone with HTF bias aligned, it proceeds to scoring.

### 1.7 Tier Changes and Open Positions

Changing the tier at runtime (via dashboard) **only affects future entries**. Existing open positions are not modified — they were valid at the time of entry and continue with their original SL/TP/trailing logic. The tier is purely an entry gate filter.

## 2. Missing SMC Components

### 2.1 Breaker Blocks

Added to `SmcAnalyzer` in `src/strategy/smc.ts`.

A breaker block is a failed order block that flips polarity. When price breaks through a bullish OB, that zone becomes bearish resistance (and vice versa).

**Detection:**
- A new `detectBreakerBlocks()` method runs after `checkMitigation()` in the `update()` cycle
- For each OB that was just mitigated this cycle, check if the candle's **close** (not just wick) has broken through:
  - Bullish OB: breaker if `last.close < ob.bottom` (close below the OB, not just `last.low`)
  - Bearish OB: breaker if `last.close > ob.top` (close above the OB, not just `last.high`)
- This is intentionally stricter than the existing wick-based mitigation check in `checkMitigation()` — a breaker requires a close-based confirmation of failure
- Bullish OB broken downward → bearish breaker (resistance)
- Bearish OB broken upward → bullish breaker (support)

**Interface:**
```typescript
interface BreakerBlock {
  type: "BULLISH" | "BEARISH";       // flipped polarity
  top: number;
  bottom: number;
  originalObType: "BULLISH" | "BEARISH";
  timestamp: number;
  barIndex: number;
  isMitigated: boolean;
}
```

**Limits:** Max 10 stored, expire after 30 bars.

**Public API:**
- `lastBreakers: BreakerBlock[]` — last 5 unmitigated
- `nearestBreaker(price, type, maxAgeBars)` — same pattern as `nearestOB`

### 2.2 Inducement

Added to `SmcAnalyzer` in `src/strategy/smc.ts`.

Inducement is a minor swing point that creates false structure, trapping retail traders and accumulating stop losses for a sweep.

**Detection:**
- After a swing HIGH/LOW is detected, check if a smaller counter-swing forms within 5 bars that doesn't break the previous major swing
- If price then sweeps past that minor swing, mark as inducement
- Minor higher-low in a downtrend (or minor lower-high in an uptrend) that gets swept

**Interface:**
```typescript
interface Inducement {
  type: "BULL_INDUCEMENT" | "BEAR_INDUCEMENT";
  level: number;
  timestamp: number;
  barIndex: number;
  isSwept: boolean;
}
```

**Limits:** Max 10 stored, expire after 20 bars.

**Public API:**
- `lastInducements: Inducement[]` — last 5
- `activeInducement: Inducement | undefined` — most recent unswept

### 2.3 Premium/Discount Zones

Added to `StructureAnalyzer` in `src/strategy/structure.ts`.

Premium/discount divides the current range (last major swing low to last major swing high) into zones.

**Detection:**
- Take last significant swing HIGH and swing LOW
- `equilibrium = (swingHigh + swingLow) / 2`
- Premium zone: price > equilibrium (selling territory)
- Discount zone: price < equilibrium (buying territory)
- For entries: LONG should be in discount, SHORT should be in premium

**Interface:**
```typescript
interface PremiumDiscount {
  swingHigh: number;
  swingLow: number;
  equilibrium: number;
  zone: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
  percentile: number;  // 0-100, where price sits in the range
}
```

No expiry — recalculated on every swing update.

**Public API:**
- `premiumDiscount(price: number): PremiumDiscount | null`

## 3. Dashboard UI Changes

### 3.1 Aggressiveness Tier Selector

Location: header bar, next to system status pill.

Three clickable buttons styled like existing state pills:
- `AGGRESSIVE` / `MODERATE` / `CONSERVATIVE`
- Active tier highlighted with amber glow, others dimmed
- Click sends `POST /api/config/tier?level=<tier>`
- Fetches current tier on mount via `GET /api/config/tier`

### 3.2 SMC Readiness Checklist

New panel below existing `SmcPanel`, per symbol. Each condition as a row:

```
HTF Bias        ● aligned     (green)
OB Zone         ● in zone     (green)
FVG Zone        ○ not in zone (red/dim)
Sweep           ○ none        (red/dim)
Displacement    ○ none        (red/dim)
BOS             ● confirmed   (green)
Breaker         ○ none        (grey — bonus)
Inducement      ○ none        (grey — bonus)
Prem/Discount   ● discount    (green)
```

- Green dot = condition met
- Red/dim dot = required by current tier but unmet
- Grey dot = bonus or not required for current tier

### 3.3 Readiness Meter

Horizontal progress bar per symbol showing `conditions met / conditions required` for current tier.

- Color gradient: red (0-30%) → amber (30-70%) → green (70-100%)
- 100% shows pulsing "READY" label
- All 3 tiers shown as stacked thin bars for at-a-glance comparison:

```
BTCUSD
Aggressive   ████████████████████ 100% READY
Moderate     ████████████░░░░░░░░  60%
Conservative ████████░░░░░░░░░░░░  40%
```

### 3.4 New SMC Columns in SmcPanel

Extend existing 3-column grid (FVGs, OBs, Sweeps) to 5 columns:
- Column 4: **Breakers** — price range, type, color-coded (same format as OBs)
- Column 5: **Inducement** — level price, swept/unswept status

Premium/Discount shown as a tag next to the symbol name (alongside existing bias tag): `DISCOUNT 35%` or `PREMIUM 72%`

### 3.5 State Server Payload Extension

`getStatePayload()` in `main.ts` extends `smcData` per symbol:

```typescript
// Existing fields preserved, plus:
breakerBlocks: BreakerBlock[]
inducements: Inducement[]
premiumDiscount: PremiumDiscount | null
tierReadiness: {
  currentTier: AggressionTier
  conditions: Array<{ name: string; met: boolean; required: boolean }>
  readiness: { aggressive: number; moderate: number; conservative: number }
}
```

Dashboard TypeScript interfaces updated to match.

## 4. Configuration

### 4.1 Environment Variable

Added to `.env.example` and `EnvSchema` in `src/config/env.ts`:

```
# SMC aggressiveness tier: aggressive (more trades, less confirmation),
# moderate (balanced), conservative (full SMC sequence required)
SMC_AGGRESSION=moderate
```

Default: `moderate`

### 4.2 Files Changed/Created

| Action | File | Description |
|--------|------|-------------|
| Create | `src/strategy/tier.filter.ts` | Tier definitions, evaluator, types |
| Create | `src/strategy/tier.filter.test.ts` | Unit tests for tier filter (pure function, all tier combinations) |
| Create | `src/config/runtime.ts` | Runtime mutable config store |
| Modify | `src/strategy/smc.ts` | Add breaker blocks, inducement detection |
| Modify | `src/strategy/smc.test.ts` | Tests for breaker block, inducement detection |
| Modify | `src/strategy/structure.ts` | Add premium/discount zone calculation |
| Modify | `src/strategy/setup.ltf.ts` | Tier-aware point values for new components |
| Modify | `src/strategy/scorer.ts` | Tier-aware min score thresholds |
| Modify | `src/strategy/strategy.runner.ts` | Integrate tier filter, accept SmcStateSnapshot param |
| Modify | `src/config/env.ts` | Add `SMC_AGGRESSION` to schema |
| Modify | `src/main.ts` | Build SmcStateSnapshot in scanSymbol(), API endpoints, extended smcData payload |
| Modify | `dashboard/src/App.tsx` | Tier selector, checklist, readiness meter, new columns |
| Modify | `.env.example` | Add `SMC_AGGRESSION` |

### 4.3 Data Flow Note

`main.ts:scanSymbol()` is responsible for building the `SmcStateSnapshot` because it owns the analyzer lifecycle:
1. `structure.update(candles15m)` — updates swings, breaks, bias
2. `smc.update(candles15m, breaks, swings, true, atr)` — updates FVGs, OBs, sweeps, displacement, breakers, inducement
3. Build `SmcStateSnapshot` from `structure.*`, `smc.*`, and current price/bias
4. Pass snapshot to `runStrategy(market, indicators, structure, smc, snapshot)`

`strategy.runner.ts` does NOT call `structure.premiumDiscount()` directly — it receives the pre-built snapshot.
