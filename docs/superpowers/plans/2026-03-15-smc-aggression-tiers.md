# SMC Aggressiveness Tiers Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3-tier aggressiveness system (aggressive/moderate/conservative) to the SMC trading engine, implement missing SMC components (breaker blocks, inducement, premium/discount zones), and surface everything on the dashboard UI.

**Architecture:** SMC analyzers always detect everything. A thin tier filter gates entries based on which conditions are required per tier. Runtime config allows switching tiers via API. Dashboard shows readiness state per symbol per tier.

**Tech Stack:** TypeScript, Node.js `node:test`, React (dashboard), WebSocket state server

**Spec:** `docs/superpowers/specs/2026-03-15-smc-aggression-tiers-design.md`

**Test command:** `npm run build && node --test dist/**/*.test.js`

**Lint command:** `npm run lint` (runs `tsc --noEmit`)

---

## Chunk 1: Foundation — Config, Premium/Discount, Runtime Store, Tier Filter

### Task 1: Add SMC_AGGRESSION to env schema

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add SMC_AGGRESSION to EnvSchema**

In `src/config/env.ts`, add to the `EnvSchema` object:

```typescript
SMC_AGGRESSION: z.enum(["aggressive", "moderate", "conservative"]).default("moderate"),
```

- [ ] **Step 2: Add to .env.example**

Append to `.env.example`:

```
# SMC aggressiveness tier: aggressive (more trades, less confirmation),
# moderate (balanced), conservative (full SMC sequence required)
SMC_AGGRESSION=moderate
```

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/config/env.ts .env.example
git commit -m "feat: add SMC_AGGRESSION env variable"
```

- [ ] **Step 5: Add to local .env (local only, do NOT commit .env)**

Add `SMC_AGGRESSION=moderate` to your local `.env` file so the app can boot.

---

### Task 2: Create runtime config store

**Files:**
- Create: `src/config/runtime.ts`

**Note:** `AggressionTier` is defined here in the config layer (not in strategy) to avoid circular dependencies. `tier.filter.ts` will import it from here.

- [ ] **Step 1: Create runtime.ts**

```typescript
import { env } from "./env.js";

/** Canonical type — owned by config layer, imported by strategy layer. */
export type AggressionTier = "aggressive" | "moderate" | "conservative";

let currentTier: AggressionTier = env.SMC_AGGRESSION as AggressionTier;

export const getRuntimeTier = (): AggressionTier => currentTier;

export const setRuntimeTier = (tier: AggressionTier): void => {
  currentTier = tier;
};

export const getRuntimeConfig = (): { tier: AggressionTier } => ({
  tier: currentTier,
});
```

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/config/runtime.ts
git commit -m "feat: add runtime config store for SMC aggression tier"
```

---

### Task 3: Add premium/discount zones to StructureAnalyzer (TDD)

**Files:**
- Modify: `src/strategy/structure.ts`

**Note:** This must run before the tier filter task because `tier.filter.ts` imports `PremiumDiscount` from `structure.ts`.

- [ ] **Step 1: Add PremiumDiscount interface**

In `src/strategy/structure.ts`, add the interface after the existing `StructureBreak` interface:

```typescript
export interface PremiumDiscount {
  swingHigh: number;
  swingLow: number;
  equilibrium: number;
  zone: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
  percentile: number;
}
```

- [ ] **Step 2: Add premiumDiscount method to StructureAnalyzer**

Add a public method to the `StructureAnalyzer` class:

```typescript
premiumDiscount(price: number): PremiumDiscount | null {
  const lastHigh = this.swings.filter(s => s.type === "HIGH").at(-1);
  const lastLow = this.swings.filter(s => s.type === "LOW").at(-1);
  if (!lastHigh || !lastLow || lastHigh.price <= lastLow.price) return null;

  const range = lastHigh.price - lastLow.price;
  const equilibrium = (lastHigh.price + lastLow.price) / 2;
  const percentile = ((price - lastLow.price) / range) * 100;

  // EQUILIBRIUM if within 2% of range from midpoint
  const eqThreshold = range * 0.02;
  let zone: PremiumDiscount["zone"];
  if (Math.abs(price - equilibrium) <= eqThreshold) {
    zone = "EQUILIBRIUM";
  } else if (price > equilibrium) {
    zone = "PREMIUM";
  } else {
    zone = "DISCOUNT";
  }

  return {
    swingHigh: lastHigh.price,
    swingLow: lastLow.price,
    equilibrium,
    zone,
    percentile: Math.round(Math.max(0, Math.min(100, percentile))),
  };
}
```

- [ ] **Step 3: Write tests for premium/discount**

Create test cases. These can be added to a new section in an existing test file or inline. Since `structure.ts` doesn't have its own test file yet, add tests to `src/strategy/smc.test.ts` (which already imports from structure.ts), or create `src/strategy/structure.test.ts`:

Add to `src/strategy/smc.test.ts` (simpler, avoids new file):

```typescript
import { StructureAnalyzer } from "./structure.js";

test("StructureAnalyzer premiumDiscount returns null with no swings", () => {
  const structure = new StructureAnalyzer();
  const result = structure.premiumDiscount(100);
  assert.equal(result, null);
});

test("StructureAnalyzer premiumDiscount identifies DISCOUNT zone", () => {
  const structure = new StructureAnalyzer();
  // Inject swings: LOW at 90, HIGH at 110 → equilibrium = 100
  (structure as any).swings = [
    { type: "LOW", price: 90, index: 1, timestamp: 1000 },
    { type: "HIGH", price: 110, index: 5, timestamp: 5000 },
  ];
  const result = structure.premiumDiscount(95);
  assert.ok(result);
  assert.equal(result.zone, "DISCOUNT");
  assert.equal(result.percentile, 25); // (95-90)/(110-90) = 25%
  assert.equal(result.equilibrium, 100);
});

test("StructureAnalyzer premiumDiscount identifies PREMIUM zone", () => {
  const structure = new StructureAnalyzer();
  (structure as any).swings = [
    { type: "LOW", price: 90, index: 1, timestamp: 1000 },
    { type: "HIGH", price: 110, index: 5, timestamp: 5000 },
  ];
  const result = structure.premiumDiscount(106);
  assert.ok(result);
  assert.equal(result.zone, "PREMIUM");
  assert.equal(result.percentile, 80);
});

test("StructureAnalyzer premiumDiscount identifies EQUILIBRIUM zone", () => {
  const structure = new StructureAnalyzer();
  (structure as any).swings = [
    { type: "LOW", price: 90, index: 1, timestamp: 1000 },
    { type: "HIGH", price: 110, index: 5, timestamp: 5000 },
  ];
  // Equilibrium = 100, threshold = 20 * 0.02 = 0.4
  const result = structure.premiumDiscount(100.3);
  assert.ok(result);
  assert.equal(result.zone, "EQUILIBRIUM");
});

test("StructureAnalyzer premiumDiscount clamps percentile 0-100", () => {
  const structure = new StructureAnalyzer();
  (structure as any).swings = [
    { type: "LOW", price: 90, index: 1, timestamp: 1000 },
    { type: "HIGH", price: 110, index: 5, timestamp: 5000 },
  ];
  const below = structure.premiumDiscount(85);
  assert.ok(below);
  assert.equal(below.percentile, 0);

  const above = structure.premiumDiscount(115);
  assert.ok(above);
  assert.equal(above.percentile, 100);
});

test("StructureAnalyzer premiumDiscount returns null when swingHigh <= swingLow", () => {
  const structure = new StructureAnalyzer();
  (structure as any).swings = [
    { type: "HIGH", price: 90, index: 1, timestamp: 1000 },
    { type: "LOW", price: 100, index: 5, timestamp: 5000 },
  ];
  const result = structure.premiumDiscount(95);
  assert.equal(result, null);
});
```

- [ ] **Step 4: Verify lint passes and tests pass**

Run: `npm run build && node --test dist/strategy/smc.test.js`
Expected: All tests PASS (existing + 6 new premium/discount tests)

- [ ] **Step 5: Commit**

```bash
git add src/strategy/structure.ts src/strategy/smc.test.ts
git commit -m "feat: add premium/discount zone calculation to StructureAnalyzer"
```

---

### Task 4: Create tier filter with tests (TDD)

**Files:**
- Create: `src/strategy/tier.filter.ts`
- Create: `src/strategy/tier.filter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/strategy/tier.filter.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTierReadiness,
  SmcStateSnapshot,
  AggressionTier,
  TIER_SCORE_THRESHOLDS,
} from "./tier.filter.js";

const baseSnapshot = (): SmcStateSnapshot => ({
  htfBiasAligned: false,
  inObZone: false,
  inFvgZone: false,
  sweepDetected: false,
  displacementDetected: false,
  bosConfirmed: false,
  breakerConfluence: false,
  inducementDetected: false,
  premiumDiscountAligned: false,
  premiumDiscount: null,
});

test("aggressive tier: passes with only bias + OB zone", () => {
  const snap = { ...baseSnapshot(), htfBiasAligned: true, inObZone: true };
  const result = evaluateTierReadiness("aggressive", snap);
  assert.equal(result.passed, true);
  assert.ok(result.met.includes("htfBias"));
  assert.ok(result.met.includes("obOrFvgZone"));
});

test("aggressive tier: passes with only bias + FVG zone (OR logic)", () => {
  const snap = { ...baseSnapshot(), htfBiasAligned: true, inFvgZone: true };
  const result = evaluateTierReadiness("aggressive", snap);
  assert.equal(result.passed, true);
});

test("aggressive tier: fails without bias", () => {
  const snap = { ...baseSnapshot(), inObZone: true };
  const result = evaluateTierReadiness("aggressive", snap);
  assert.equal(result.passed, false);
  assert.ok(result.unmet.includes("htfBias"));
});

test("aggressive tier: fails without OB or FVG", () => {
  const snap = { ...baseSnapshot(), htfBiasAligned: true };
  const result = evaluateTierReadiness("aggressive", snap);
  assert.equal(result.passed, false);
  assert.ok(result.unmet.includes("obOrFvgZone"));
});

test("moderate tier: requires bias + zone + sweep + BOS", () => {
  const snap = {
    ...baseSnapshot(),
    htfBiasAligned: true,
    inObZone: true,
    sweepDetected: true,
    bosConfirmed: true,
  };
  const result = evaluateTierReadiness("moderate", snap);
  assert.equal(result.passed, true);
});

test("moderate tier: fails without sweep", () => {
  const snap = {
    ...baseSnapshot(),
    htfBiasAligned: true,
    inObZone: true,
    bosConfirmed: true,
  };
  const result = evaluateTierReadiness("moderate", snap);
  assert.equal(result.passed, false);
  assert.ok(result.unmet.includes("sweep"));
});

test("moderate tier: fails without BOS", () => {
  const snap = {
    ...baseSnapshot(),
    htfBiasAligned: true,
    inObZone: true,
    sweepDetected: true,
  };
  const result = evaluateTierReadiness("moderate", snap);
  assert.equal(result.passed, false);
  assert.ok(result.unmet.includes("bos"));
});

test("conservative tier: requires all mandatory conditions", () => {
  const snap: SmcStateSnapshot = {
    htfBiasAligned: true,
    inObZone: true,
    inFvgZone: false,
    sweepDetected: true,
    displacementDetected: true,
    bosConfirmed: true,
    breakerConfluence: true,
    inducementDetected: false,
    premiumDiscountAligned: true,
    premiumDiscount: null,
  };
  const result = evaluateTierReadiness("conservative", snap);
  assert.equal(result.passed, true);
});

test("conservative tier: fails without displacement", () => {
  const snap: SmcStateSnapshot = {
    htfBiasAligned: true,
    inObZone: true,
    inFvgZone: false,
    sweepDetected: true,
    displacementDetected: false,
    bosConfirmed: true,
    breakerConfluence: true,
    inducementDetected: false,
    premiumDiscountAligned: true,
    premiumDiscount: null,
  };
  const result = evaluateTierReadiness("conservative", snap);
  assert.equal(result.passed, false);
  assert.ok(result.unmet.includes("displacement"));
});

test("conservative tier: fails without breaker confluence", () => {
  const snap: SmcStateSnapshot = {
    htfBiasAligned: true,
    inObZone: true,
    inFvgZone: false,
    sweepDetected: true,
    displacementDetected: true,
    bosConfirmed: true,
    breakerConfluence: false,
    inducementDetected: false,
    premiumDiscountAligned: true,
    premiumDiscount: null,
  };
  const result = evaluateTierReadiness("conservative", snap);
  assert.equal(result.passed, false);
});

test("conservative tier: fails without premium/discount aligned", () => {
  const snap: SmcStateSnapshot = {
    htfBiasAligned: true,
    inObZone: true,
    inFvgZone: false,
    sweepDetected: true,
    displacementDetected: true,
    bosConfirmed: true,
    breakerConfluence: true,
    inducementDetected: false,
    premiumDiscountAligned: false,
    premiumDiscount: null,
  };
  const result = evaluateTierReadiness("conservative", snap);
  assert.equal(result.passed, false);
});

test("readiness percentages: all conditions met = 100% for all tiers", () => {
  const snap: SmcStateSnapshot = {
    htfBiasAligned: true,
    inObZone: true,
    inFvgZone: true,
    sweepDetected: true,
    displacementDetected: true,
    bosConfirmed: true,
    breakerConfluence: true,
    inducementDetected: true,
    premiumDiscountAligned: true,
    premiumDiscount: null,
  };
  const result = evaluateTierReadiness("aggressive", snap);
  assert.equal(result.readiness.aggressive, 100);
  assert.equal(result.readiness.moderate, 100);
  assert.equal(result.readiness.conservative, 100);
});

test("readiness percentages: nothing met = 0% for all tiers", () => {
  const result = evaluateTierReadiness("aggressive", baseSnapshot());
  assert.equal(result.readiness.aggressive, 0);
  assert.equal(result.readiness.moderate, 0);
  assert.equal(result.readiness.conservative, 0);
});

test("score thresholds are exported correctly", () => {
  assert.equal(TIER_SCORE_THRESHOLDS.aggressive, 3);
  assert.equal(TIER_SCORE_THRESHOLDS.moderate, 5);
  assert.equal(TIER_SCORE_THRESHOLDS.conservative, 8);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test dist/strategy/tier.filter.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the tier filter implementation**

Create `src/strategy/tier.filter.ts`:

```typescript
import { AggressionTier } from "../config/runtime.js";
import { PremiumDiscount } from "./structure.js";

export { AggressionTier } from "../config/runtime.js";

export type TierConditionName =
  | "htfBias"
  | "obOrFvgZone"
  | "sweep"
  | "displacement"
  | "bos"
  | "breaker"
  | "inducement"
  | "premiumDiscount";

export interface SmcStateSnapshot {
  htfBiasAligned: boolean;
  inObZone: boolean;
  inFvgZone: boolean;
  sweepDetected: boolean;
  displacementDetected: boolean;
  bosConfirmed: boolean;
  breakerConfluence: boolean;
  inducementDetected: boolean;
  premiumDiscountAligned: boolean;
  premiumDiscount: PremiumDiscount | null;
}

export interface TierReadinessResult {
  passed: boolean;
  met: TierConditionName[];
  unmet: TierConditionName[];
  readiness: Record<AggressionTier, number>;
}

export const TIER_SCORE_THRESHOLDS: Record<AggressionTier, number> = {
  aggressive: 3,
  moderate: 5,
  conservative: 8,
};

/** Bonus point values for new SMC components per tier. */
export const TIER_BONUS_POINTS: Record<AggressionTier, Record<string, number>> = {
  aggressive:   { breaker: 2, inducement: 1, premiumDiscount: 2 },
  moderate:     { breaker: 2, inducement: 1, premiumDiscount: 2 },
  conservative: { breaker: 2, inducement: 2, premiumDiscount: 2 },
};

type Requirement = "required" | "bonus" | "ignored";

interface TierRequirements {
  htfBias: Requirement;
  obOrFvgZone: Requirement;
  sweep: Requirement;
  displacement: Requirement;
  bos: Requirement;
  breaker: Requirement;
  inducement: Requirement;
  premiumDiscount: Requirement;
}

/** Exported so state payload can derive `required` flags without duplication. */
export const TIER_REQUIREMENTS: Record<AggressionTier, TierRequirements> = {
  aggressive: {
    htfBias: "required",
    obOrFvgZone: "required",
    sweep: "ignored",
    displacement: "ignored",
    bos: "ignored",
    breaker: "bonus",
    inducement: "bonus",
    premiumDiscount: "bonus",
  },
  moderate: {
    htfBias: "required",
    obOrFvgZone: "required",
    sweep: "required",
    displacement: "ignored",
    bos: "required",
    breaker: "bonus",
    inducement: "bonus",
    premiumDiscount: "bonus",
  },
  conservative: {
    htfBias: "required",
    obOrFvgZone: "required",
    sweep: "required",
    displacement: "required",
    bos: "required",
    breaker: "required",
    inducement: "bonus",
    premiumDiscount: "required",
  },
};

const resolveCondition = (
  name: TierConditionName,
  snap: SmcStateSnapshot
): boolean => {
  switch (name) {
    case "htfBias":
      return snap.htfBiasAligned;
    case "obOrFvgZone":
      return snap.inObZone || snap.inFvgZone;
    case "sweep":
      return snap.sweepDetected;
    case "displacement":
      return snap.displacementDetected;
    case "bos":
      return snap.bosConfirmed;
    case "breaker":
      return snap.breakerConfluence;
    case "inducement":
      return snap.inducementDetected;
    case "premiumDiscount":
      return snap.premiumDiscountAligned;
  }
};

const ALL_CONDITIONS: TierConditionName[] = [
  "htfBias",
  "obOrFvgZone",
  "sweep",
  "displacement",
  "bos",
  "breaker",
  "inducement",
  "premiumDiscount",
];

const computeReadiness = (
  tier: AggressionTier,
  snap: SmcStateSnapshot
): number => {
  const reqs = TIER_REQUIREMENTS[tier];
  const required = ALL_CONDITIONS.filter(
    (c) => reqs[c] === "required"
  );
  if (required.length === 0) return 100;
  const met = required.filter((c) => resolveCondition(c, snap));
  return Math.round((met.length / required.length) * 100);
};

export const evaluateTierReadiness = (
  tier: AggressionTier,
  snap: SmcStateSnapshot
): TierReadinessResult => {
  const reqs = TIER_REQUIREMENTS[tier];
  const met: TierConditionName[] = [];
  const unmet: TierConditionName[] = [];

  for (const condition of ALL_CONDITIONS) {
    const requirement = reqs[condition];
    if (requirement === "ignored") continue;

    const isMet = resolveCondition(condition, snap);
    if (isMet) {
      met.push(condition);
    } else if (requirement === "required") {
      unmet.push(condition);
    }
    // bonus conditions that aren't met are simply not added to either list
  }

  return {
    passed: unmet.length === 0,
    met,
    unmet,
    readiness: {
      aggressive: computeReadiness("aggressive", snap),
      moderate: computeReadiness("moderate", snap),
      conservative: computeReadiness("conservative", snap),
    },
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/strategy/tier.filter.test.js`
Expected: All 14 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm run build && node --test dist/**/*.test.js`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/strategy/tier.filter.ts src/strategy/tier.filter.test.ts
git commit -m "feat: add tier filter with aggressive/moderate/conservative gating"
```

---

## Chunk 2: Missing SMC Components — Breaker Blocks, Inducement

### Task 5: Add breaker blocks to SmcAnalyzer with tests (TDD)

**(Note: Task 4 was premium/discount, already done in Chunk 1 as Task 3)**

**Files:**
- Modify: `src/strategy/smc.ts`
- Modify: `src/strategy/smc.test.ts`

- [ ] **Step 1: Write failing tests for breaker blocks**

Append to `src/strategy/smc.test.ts`:

```typescript
test("SmcAnalyzer detects bearish breaker from failed bullish OB", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });

  // Manually inject a bullish OB
  (analyzer as any).obs = [
    {
      type: "BULLISH",
      top: 105,
      bottom: 100,
      timestamp: 1_740_000_000_000,
      barIndex: 100,
      volume: 20,
      isMitigated: false,
    },
  ];

  // Candle that closes below the OB bottom (breaks it)
  const candles: DeltaCandle[] = [];
  for (let i = 0; i < 5; i++) {
    candles.push({
      timestamp: 1_740_000_000_000 + (i + 1) * RESOLUTION_MS,
      open: 102,
      high: 103,
      low: 98,
      close: 99, // closes below OB bottom (100)
      volume: 15,
    });
  }

  analyzer.update(candles, [], [], false);

  const breakers = analyzer.lastBreakers;
  assert.equal(breakers.length, 1);
  assert.equal(breakers[0]!.type, "BEARISH"); // flipped polarity
  assert.equal(breakers[0]!.originalObType, "BULLISH");
  assert.equal(breakers[0]!.top, 105);
  assert.equal(breakers[0]!.bottom, 100);
});

test("SmcAnalyzer detects bullish breaker from failed bearish OB", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });

  (analyzer as any).obs = [
    {
      type: "BEARISH",
      top: 105,
      bottom: 100,
      timestamp: 1_740_000_000_000,
      barIndex: 100,
      volume: 20,
      isMitigated: false,
    },
  ];

  const candles: DeltaCandle[] = [];
  for (let i = 0; i < 5; i++) {
    candles.push({
      timestamp: 1_740_000_000_000 + (i + 1) * RESOLUTION_MS,
      open: 103,
      high: 107,
      low: 102,
      close: 106, // closes above OB top (105)
      volume: 15,
    });
  }

  analyzer.update(candles, [], [], false);

  const breakers = analyzer.lastBreakers;
  assert.equal(breakers.length, 1);
  assert.equal(breakers[0]!.type, "BULLISH");
  assert.equal(breakers[0]!.originalObType, "BEARISH");
});

test("SmcAnalyzer does not create breaker on wick-only mitigation", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });

  (analyzer as any).obs = [
    {
      type: "BULLISH",
      top: 105,
      bottom: 100,
      timestamp: 1_740_000_000_000,
      barIndex: 100,
      volume: 20,
      isMitigated: false,
    },
  ];

  // Wick touches below OB bottom but close stays inside
  const candles: DeltaCandle[] = [];
  for (let i = 0; i < 5; i++) {
    candles.push({
      timestamp: 1_740_000_000_000 + (i + 1) * RESOLUTION_MS,
      open: 102,
      high: 103,
      low: 98,   // wick below 100
      close: 101, // but closes above 100 — mitigated but not broken
      volume: 15,
    });
  }

  analyzer.update(candles, [], [], false);

  // OB should be mitigated (wick touch) but no breaker (close didn't break)
  const breakers = analyzer.lastBreakers;
  assert.equal(breakers.length, 0);
});

test("SmcAnalyzer nearestBreaker finds closest unmitigated breaker", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });

  (analyzer as any).breakers = [
    {
      type: "BEARISH",
      top: 105,
      bottom: 100,
      originalObType: "BULLISH",
      timestamp: 1_740_000_000_000,
      barIndex: 100,
      isMitigated: false,
    },
    {
      type: "BEARISH",
      top: 112,
      bottom: 110,
      originalObType: "BULLISH",
      timestamp: 1_740_000_000_000 + RESOLUTION_MS,
      barIndex: 101,
      isMitigated: false,
    },
  ];
  (analyzer as any).lastProcessedTimestamp = 102 * RESOLUTION_MS;

  const nearest = analyzer.nearestBreaker(103, "BEARISH");
  assert.ok(nearest);
  assert.equal(nearest.top, 105);
  assert.equal(nearest.bottom, 100);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test dist/strategy/smc.test.js`
Expected: FAIL — `lastBreakers` and `nearestBreaker` don't exist

- [ ] **Step 3: Add BreakerBlock interface and detection to SmcAnalyzer**

In `src/strategy/smc.ts`, add the interface after `LiquiditySweep`:

```typescript
export interface BreakerBlock {
  type: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  originalObType: "BULLISH" | "BEARISH";
  timestamp: number;
  barIndex: number;
  isMitigated: boolean;
}
```

Add to `SMC_CONFIG`:

```typescript
maxBreakers: 10,
breakerMaxAgeBars: 30,
```

Add to the `SmcAnalyzer` class:

1. Private field: `private breakers: BreakerBlock[] = [];`

2. In the `update()` method, add `this.detectBreakerBlocks(normalized);` after `this.checkMitigation(normalized);`

3. Add the detection method:

```typescript
private detectBreakerBlocks(candles: readonly DeltaCandle[]) {
  const last = candles.at(-1);
  if (!last) return;

  for (const ob of this.obs) {
    if (!ob.isMitigated) continue;

    // Breaker requires close-based break, not just wick touch
    let isBroken = false;
    let breakerType: BreakerBlock["type"];

    if (ob.type === "BULLISH" && last.close < ob.bottom) {
      isBroken = true;
      breakerType = "BEARISH"; // flipped
    } else if (ob.type === "BEARISH" && last.close > ob.top) {
      isBroken = true;
      breakerType = "BULLISH"; // flipped
    } else {
      continue;
    }

    if (!isBroken) continue;

    // Don't duplicate
    const exists = this.breakers.some(
      (b) => b.timestamp === ob.timestamp && b.originalObType === ob.type
    );
    if (exists) continue;

    this.breakers.push({
      type: breakerType!,
      top: ob.top,
      bottom: ob.bottom,
      originalObType: ob.type,
      timestamp: ob.timestamp,
      barIndex: ob.barIndex,
      isMitigated: false,
    });

    if (this.breakers.length > SMC_CONFIG.maxBreakers) this.breakers.shift();
  }

  // Expire old breakers
  const currentBarIndex = this.barIndex(this.lastProcessedTimestamp);
  this.breakers = this.breakers.filter(
    (b) => currentBarIndex - b.barIndex <= SMC_CONFIG.breakerMaxAgeBars
  );

  // Check breaker mitigation (price returns to breaker zone)
  for (const b of this.breakers) {
    if (b.isMitigated) continue;
    if (b.type === "BULLISH" && last.low <= b.top && last.close >= b.bottom) {
      b.isMitigated = true;
    }
    if (b.type === "BEARISH" && last.high >= b.bottom && last.close <= b.top) {
      b.isMitigated = true;
    }
  }
}
```

4. Add public accessors:

```typescript
get lastBreakers(): BreakerBlock[] {
  return this.breakers.filter((b) => !b.isMitigated).slice(-5);
}

nearestBreaker(
  price: number,
  type: BreakerBlock["type"],
  maxAgeBars = SMC_CONFIG.nearestZoneMaxAgeBars
): NearestZone | null {
  const currentBarIndex = this.barIndex(this.lastProcessedTimestamp);
  const candidates = this.breakers.filter(
    (b) =>
      !b.isMitigated &&
      b.type === type &&
      currentBarIndex - b.barIndex <= Math.max(0, maxAgeBars)
  );
  return this.pickNearestZone(candidates, price);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/strategy/smc.test.js`
Expected: All tests PASS (existing + 4 new)

- [ ] **Step 5: Commit**

```bash
git add src/strategy/smc.ts src/strategy/smc.test.ts
git commit -m "feat: add breaker block detection to SmcAnalyzer"
```

---

### Task 6: Add inducement detection to SmcAnalyzer with tests (TDD)

**Files:**
- Modify: `src/strategy/smc.ts`
- Modify: `src/strategy/smc.test.ts`

- [ ] **Step 1: Write failing tests for inducement**

Append to `src/strategy/smc.test.ts`:

```typescript
test("SmcAnalyzer detects bear inducement (minor higher-low in downtrend swept)", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });
  const baseTs = 1_740_000_000_000;

  // Need major swing LOW, then a minor higher-low that gets swept
  const majorSwings: SwingPoint[] = [
    { type: "HIGH", price: 110, index: 5, timestamp: baseTs + 5 * RESOLUTION_MS },
    { type: "LOW", price: 95, index: 10, timestamp: baseTs + 10 * RESOLUTION_MS },
  ];

  // Minor swing: higher-low at 97 (above major low of 95) — inducement
  const minorSwings: SwingPoint[] = [
    ...majorSwings,
    { type: "LOW", price: 97, index: 13, timestamp: baseTs + 13 * RESOLUTION_MS },
  ];

  // Build candles where price sweeps below the minor low (97)
  const candles: DeltaCandle[] = [];
  for (let i = 0; i < 21; i++) {
    candles.push({
      timestamp: baseTs + i * RESOLUTION_MS,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
    });
  }
  // Last candle sweeps below 97
  const last = candles[candles.length - 1]!;
  last.low = 96;
  last.close = 98;

  analyzer.update(candles, [], minorSwings, false);

  const inducements = analyzer.lastInducements;
  assert.ok(inducements.length >= 1);
  const ind = inducements.find((i) => i.type === "BEAR_INDUCEMENT");
  assert.ok(ind);
  assert.equal(ind.level, 97);
  assert.equal(ind.isSwept, true);
});

test("SmcAnalyzer detects bull inducement (minor lower-high in uptrend swept)", () => {
  const analyzer = new SmcAnalyzer({ resolutionMs: RESOLUTION_MS });
  const baseTs = 1_740_000_000_000;

  const swings: SwingPoint[] = [
    { type: "LOW", price: 90, index: 5, timestamp: baseTs + 5 * RESOLUTION_MS },
    { type: "HIGH", price: 110, index: 10, timestamp: baseTs + 10 * RESOLUTION_MS },
    // Minor lower-high at 108 (below major high of 110) — inducement
    { type: "HIGH", price: 108, index: 13, timestamp: baseTs + 13 * RESOLUTION_MS },
  ];

  const candles: DeltaCandle[] = [];
  for (let i = 0; i < 21; i++) {
    candles.push({
      timestamp: baseTs + i * RESOLUTION_MS,
      open: 106,
      high: 107,
      low: 105,
      close: 106,
      volume: 10,
    });
  }
  // Last candle sweeps above 108
  const last = candles[candles.length - 1]!;
  last.high = 109;
  last.close = 107;

  analyzer.update(candles, [], swings, false);

  const inducements = analyzer.lastInducements;
  const ind = inducements.find((i) => i.type === "BULL_INDUCEMENT");
  assert.ok(ind);
  assert.equal(ind.level, 108);
  assert.equal(ind.isSwept, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test dist/strategy/smc.test.js`
Expected: FAIL — `lastInducements` doesn't exist

- [ ] **Step 3: Add Inducement interface and detection**

In `src/strategy/smc.ts`, add the interface:

```typescript
export interface Inducement {
  type: "BULL_INDUCEMENT" | "BEAR_INDUCEMENT";
  level: number;
  timestamp: number;
  barIndex: number;
  isSwept: boolean;
}
```

Add to `SMC_CONFIG`:

```typescript
maxInducements: 10,
inducementMaxAgeBars: 20,
inducementLookbackBars: 5,
```

Add to `SmcAnalyzer` class:

1. Private field: `private inducements: Inducement[] = [];`

2. In the `update()` method, add `this.detectInducements(normalized, swings);` after `this.detectBreakerBlocks(normalized);`

3. Detection method:

```typescript
private detectInducements(
  candles: readonly DeltaCandle[],
  swings: SwingPoint[]
) {
  const last = candles.at(-1);
  if (!last || swings.length < 3) return;

  const currentBarIndex = this.barIndex(this.lastProcessedTimestamp);

  // Find major swing pairs and look for minor counter-swings between them
  const highs = swings.filter((s) => s.type === "HIGH");
  const lows = swings.filter((s) => s.type === "LOW");

  // Bear inducement: in a downtrend (after a major LOW), a minor higher-low
  // forms that is above the major low but within lookback range
  const lastMajorLow = lows.at(-2); // second-to-last is the "major"
  const minorLow = lows.at(-1);     // last is potential inducement
  if (
    lastMajorLow &&
    minorLow &&
    minorLow.price > lastMajorLow.price &&
    currentBarIndex - minorLow.index <= SMC_CONFIG.inducementLookbackBars
  ) {
    const existing = this.inducements.find(
      (ind) => ind.level === minorLow.price && ind.type === "BEAR_INDUCEMENT"
    );
    if (!existing) {
      const isSwept = last.low < minorLow.price;
      this.inducements.push({
        type: "BEAR_INDUCEMENT",
        level: minorLow.price,
        timestamp: minorLow.timestamp,
        barIndex: minorLow.index,
        isSwept,
      });
    } else if (!existing.isSwept && last.low < minorLow.price) {
      existing.isSwept = true;
    }
  }

  // Bull inducement: in an uptrend (after a major HIGH), a minor lower-high
  // forms that is below the major high
  const lastMajorHigh = highs.at(-2);
  const minorHigh = highs.at(-1);
  if (
    lastMajorHigh &&
    minorHigh &&
    minorHigh.price < lastMajorHigh.price &&
    currentBarIndex - minorHigh.index <= SMC_CONFIG.inducementLookbackBars
  ) {
    const existing = this.inducements.find(
      (ind) => ind.level === minorHigh.price && ind.type === "BULL_INDUCEMENT"
    );
    if (!existing) {
      const isSwept = last.high > minorHigh.price;
      this.inducements.push({
        type: "BULL_INDUCEMENT",
        level: minorHigh.price,
        timestamp: minorHigh.timestamp,
        barIndex: minorHigh.index,
        isSwept,
      });
    } else if (!existing.isSwept && last.high > minorHigh.price) {
      existing.isSwept = true;
    }
  }

  // Expire old inducements
  this.inducements = this.inducements.filter(
    (ind) => currentBarIndex - ind.barIndex <= SMC_CONFIG.inducementMaxAgeBars
  );
  if (this.inducements.length > SMC_CONFIG.maxInducements) {
    this.inducements = this.inducements.slice(-SMC_CONFIG.maxInducements);
  }
}
```

4. Public accessors:

```typescript
get lastInducements(): Inducement[] {
  return this.inducements.slice(-5);
}

get activeInducement(): Inducement | undefined {
  return this.inducements.filter((i) => !i.isSwept).at(-1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/strategy/smc.test.js`
Expected: All tests PASS (existing + breaker + inducement)

- [ ] **Step 5: Run full test suite**

Run: `npm run build && node --test dist/**/*.test.js`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/strategy/smc.ts src/strategy/smc.test.ts
git commit -m "feat: add inducement detection to SmcAnalyzer"
```

---

## Chunk 3: Strategy Integration — Scoring, Runner, Main

### Task 7: Add tier-aware bonus scoring to setup.ltf.ts

**Files:**
- Modify: `src/strategy/setup.ltf.ts`

- [ ] **Step 1: Import tier types and add new scoring**

Add imports at top of `src/strategy/setup.ltf.ts`:

```typescript
import { AggressionTier, TIER_BONUS_POINTS } from "./tier.filter.js";
import { BreakerBlock, Inducement } from "./smc.js";
import { PremiumDiscount } from "./structure.js";
```

Update `detectLTFSetup` signature to accept tier and new data:

```typescript
export const detectLTFSetup = (
  bias: Bias,
  market: MarketCache,
  indicators: IndicatorCache,
  structure?: StructureAnalyzer,
  smc?: SmcAnalyzer,
  tier: AggressionTier = "moderate",
  premiumDiscount?: PremiumDiscount | null
): SetupSignal | null => {
```

After the existing displacement confluence section (section 3), add new scoring:

```typescript
  // 5. Breaker Block Confluence (new)
  if (smc) {
    const breakerType = bias === "LONG" ? "BULLISH" : "BEARISH";
    const nearBreaker = smc.nearestBreaker(last.close, breakerType as any);
    if (nearBreaker && nearBreaker.isInside) {
      const pts = TIER_BONUS_POINTS[tier].breaker;
      score += pts;
      reasons.push(`In ${breakerType} Breaker Block (+${pts})`);
    }
  }

  // 6. Inducement Confluence (new)
  if (smc) {
    const inducement = smc.activeInducement;
    if (inducement) {
      const aligned =
        (bias === "LONG" && inducement.type === "BEAR_INDUCEMENT" && inducement.isSwept) ||
        (bias === "SHORT" && inducement.type === "BULL_INDUCEMENT" && inducement.isSwept);
      if (aligned) {
        const pts = TIER_BONUS_POINTS[tier].inducement;
        score += pts;
        reasons.push(`Inducement swept (+${pts})`);
      }
    }
  }

  // 7. Premium/Discount Zone Confluence (new)
  if (premiumDiscount && premiumDiscount.zone !== "EQUILIBRIUM") {
    const aligned =
      (bias === "LONG" && premiumDiscount.zone === "DISCOUNT") ||
      (bias === "SHORT" && premiumDiscount.zone === "PREMIUM");
    if (aligned) {
      const pts = TIER_BONUS_POINTS[tier].premiumDiscount;
      score += pts;
      reasons.push(`${premiumDiscount.zone} zone ${premiumDiscount.percentile}% (+${pts})`);
    }
  }
```

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/strategy/setup.ltf.ts
git commit -m "feat: add tier-aware bonus scoring for breaker, inducement, premium/discount"
```

---

### Task 8: Add tier-aware score threshold to scorer.ts

**Files:**
- Modify: `src/strategy/scorer.ts`

- [ ] **Step 1: Update scoreSetup to accept tier threshold**

Replace the contents of `src/strategy/scorer.ts`:

```typescript
import { SetupSignal } from "./types.js";
import { IndicatorSnapshot } from "../indicators/types.js";
import { AggressionTier, TIER_SCORE_THRESHOLDS } from "./tier.filter.js";

export const scoreSetup = (
  setup: SetupSignal,
  htfIndicators: IndicatorSnapshot,
  tier: AggressionTier = "moderate"
): SetupSignal | null => {
  let score = setup.score;
  const reasons = [...setup.reasons];

  // Trend strength bonus
  if (
    htfIndicators.ema200 !== undefined &&
    htfIndicators.rsi14 !== undefined &&
    Math.abs(htfIndicators.rsi14 - 50) > 10
  ) {
    score += 3;
    reasons.push("Strong HTF trend");
  }

  // Volatility sanity
  if (htfIndicators.atr14 !== undefined && htfIndicators.atr14 > 0) {
    score += 1;
    reasons.push("ATR healthy");
  }

  const threshold = TIER_SCORE_THRESHOLDS[tier];
  if (score < threshold) return null;

  return { ...setup, score, reasons };
};
```

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/strategy/scorer.ts
git commit -m "feat: tier-aware score thresholds in scorer"
```

---

### Task 9: Integrate tier filter into strategy runner

**Files:**
- Modify: `src/strategy/strategy.runner.ts`

- [ ] **Step 1: Update strategy runner**

Replace the contents of `src/strategy/strategy.runner.ts`:

```typescript
import { MarketCache } from "../market/market.cache.js";
import { IndicatorCache } from "../indicators/indicator.cache.js";
import { computeHTFBias } from "./bias.htf.js";
import { detectLTFSetup } from "./setup.ltf.js";
import { scoreSetup } from "./scorer.js";
import { SetupSignal } from "./types.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { StructureAnalyzer } from "./structure.js";
import { SmcAnalyzer } from "./smc.js";
import { getRuntimeTier } from "../config/runtime.js";
import {
  evaluateTierReadiness,
  SmcStateSnapshot,
  TierReadinessResult,
} from "./tier.filter.js";

export interface StrategyResult {
  setup: SetupSignal;
  tierReadiness: TierReadinessResult;
}

const EMPTY_SNAPSHOT: SmcStateSnapshot = {
  htfBiasAligned: false, inObZone: false, inFvgZone: false,
  sweepDetected: false, displacementDetected: false, bosConfirmed: false,
  breakerConfluence: false, inducementDetected: false,
  premiumDiscountAligned: false, premiumDiscount: null,
};

export const runStrategy = async (
  market: MarketCache,
  indicators: IndicatorCache,
  structure?: StructureAnalyzer,
  smc?: SmcAnalyzer,
  smcSnapshot?: SmcStateSnapshot
): Promise<StrategyResult | null> => {
  // Hard readiness checks
  if (!indicators.isReady("15m") || !indicators.isReady("5m")) {
    logger.debug(`[ARES.STRATEGY] Indicators not ready (15m: ${indicators.isReady('15m')}, 5m: ${indicators.isReady('5m')})`);
    return null;
  }

  const bias = computeHTFBias(market, indicators, structure);
  if (bias === "NONE") {
    logger.debug("[ARES.STRATEGY] Bias is NONE");
    return null;
  }

  // Tier gate filter
  const tier = getRuntimeTier();
  let tierReadiness: TierReadinessResult | undefined;

  if (smcSnapshot) {
    tierReadiness = evaluateTierReadiness(tier, smcSnapshot);
    if (!tierReadiness.passed) {
      logger.debug(
        `[ARES.STRATEGY] Tier '${tier}' gate not passed. Unmet: ${tierReadiness.unmet.join(", ")}`
      );
      return null;
    }
  }

  const premiumDiscount = smcSnapshot?.premiumDiscount ?? null;
  const setup = detectLTFSetup(bias, market, indicators, structure, smc, tier, premiumDiscount);
  if (!setup) {
    logger.debug(`[ARES.STRATEGY] No LTF setup for bias ${bias}`);
    return null;
  }

  const scored = scoreSetup(setup, indicators.snapshot("15m"), tier);
  if (!scored) {
    if (env.TRADING_MODE === "paper" && env.PAPER_BYPASS_SCORE) {
      logger.warn("[ARES.STRATEGY] Score below threshold; bypassing in paper");
      return {
        setup,
        tierReadiness: tierReadiness ?? evaluateTierReadiness(tier, smcSnapshot ?? EMPTY_SNAPSHOT),
      };
    }
    logger.debug("[ARES.STRATEGY] Setup score below threshold");
    return null;
  }
  logger.debug(`[ARES.STRATEGY] Setup scored=${scored.score}`);

  return {
    setup: scored,
    tierReadiness: tierReadiness ?? evaluateTierReadiness(tier, smcSnapshot ?? {
      htfBiasAligned: false, inObZone: false, inFvgZone: false,
      sweepDetected: false, displacementDetected: false, bosConfirmed: false,
      breakerConfluence: false, inducementDetected: false,
      premiumDiscountAligned: false, premiumDiscount: null,
    }),
  };
};
```

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `npm run build && node --test dist/**/*.test.js`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/strategy/strategy.runner.ts
git commit -m "feat: integrate tier filter into strategy runner"
```

---

### Task 10: Build SmcStateSnapshot in main.ts + API endpoints

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add imports**

Add to top of `main.ts`:

```typescript
import { getRuntimeTier, setRuntimeTier } from "./config/runtime.js";
import { SmcStateSnapshot, evaluateTierReadiness, TIER_REQUIREMENTS } from "./strategy/tier.filter.js";
import { AggressionTier } from "./config/runtime.js";
import { PremiumDiscount } from "./strategy/structure.js";
```

- [ ] **Step 2: Add buildSmcSnapshot helper function**

Add after the existing helper functions (around line 213):

```typescript
const buildSmcSnapshot = (
  ctx: SymbolContext,
  effectiveBias: string
): SmcStateSnapshot => {
  const currentPrice = ctx.market.lastPrice();
  const pd = ctx.structure.premiumDiscount(currentPrice);

  const isLong = effectiveBias === "LONG";
  const premiumDiscountAligned = pd !== null && pd.zone !== "EQUILIBRIUM" && (
    (isLong && pd.zone === "DISCOUNT") ||
    (!isLong && pd.zone === "PREMIUM")
  );

  return {
    htfBiasAligned: effectiveBias !== "NONE",
    inObZone: !!ctx.smc.nearestOB(currentPrice, isLong ? "BULLISH" : "BEARISH")?.isInside,
    inFvgZone: !!ctx.smc.nearestFVG(currentPrice, isLong ? "BULLISH" : "BEARISH")?.isInside,
    sweepDetected: ctx.smc.activeSweep !== undefined,
    displacementDetected: ctx.smc.lastDisplacement !== null,
    bosConfirmed: ctx.structure.lastBreaks.some((b) =>
      isLong ? b.side === "UP" && b.type === "BOS" : b.side === "DOWN" && b.type === "BOS"
    ),
    breakerConfluence: !!ctx.smc.nearestBreaker(currentPrice, isLong ? "BULLISH" : "BEARISH")?.isInside,
    inducementDetected: (() => {
      const ind = ctx.smc.activeInducement;
      if (!ind) return false;
      return (isLong && ind.type === "BEAR_INDUCEMENT" && ind.isSwept) ||
             (!isLong && ind.type === "BULL_INDUCEMENT" && ind.isSwept);
    })(),
    premiumDiscountAligned,
    premiumDiscount: pd,
  };
};
```

- [ ] **Step 3: Update scanSymbol to build snapshot and pass to runStrategy**

In `scanSymbol()`, after the `smc.update()` call and before the displacement check, add:

```typescript
  const smcSnapshot = buildSmcSnapshot(ctx, effectiveBias);
```

Update the call to `runStrategy` (if used) to pass the snapshot. Note: the current `scanSymbol` doesn't call `runStrategy` — it has inline logic. The snapshot will be used for the state payload and future integration. For now, the tier gate is checked inline:

After building the snapshot, add the tier gate check:

```typescript
  // Tier gate check
  const tier = getRuntimeTier();
  const tierResult = evaluateTierReadiness(tier, smcSnapshot);
  if (!tierResult.passed && !isDevMode()) {
    logger.debug(`[ARES.STRATEGY] Tier '${tier}' gate not passed for ${ctx.symbol}. Unmet: ${tierResult.unmet.join(", ")}`);
    fsm.setSignalState(SignalState.HTF_BIAS_CONFIRMED);
    return;
  }
```

- [ ] **Step 4: Add API endpoints for tier config**

In the `stateServer` request handler, add before the `res.writeHead(404)` fallback:

```typescript
  // GET /api/config/tier — return current tier
  if (req.method === "GET" && req.url === "/api/config/tier") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tier: getRuntimeTier() }));
    return;
  }

  // POST /api/config/tier?level=aggressive — set tier
  if (req.method === "POST" && req.url?.startsWith("/api/config/tier")) {
    const url = new URL(req.url, "http://localhost");
    const level = url.searchParams.get("level");
    const validTiers: AggressionTier[] = ["aggressive", "moderate", "conservative"];
    if (!level || !validTiers.includes(level as AggressionTier)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Invalid tier. Must be one of: ${validTiers.join(", ")}` }));
      return;
    }
    setRuntimeTier(level as AggressionTier);
    logger.info(`[ARES.CONFIG] Aggression tier changed to '${level}'`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tier: level }));
    return;
  }
```

- [ ] **Step 5: Extend getStatePayload with new SMC data**

In `getStatePayload()`, update the `smcData` object (around line 257) to include new fields:

```typescript
smcData: Object.fromEntries(
  Array.from(symbolContexts.entries()).map(([symbol, ctx]) => {
    const currentPrice = watchlistLtps.get(symbol) ?? ctx.market.lastPrice();
    const pd = ctx.structure.premiumDiscount(currentPrice);
    const bias = ctx.structure.lastBias;
    const effectiveBias = bias === "BULLISH" ? "LONG" : bias === "BEARISH" ? "SHORT" : "NONE";
    const snapshot = buildSmcSnapshot(ctx, effectiveBias);
    const tier = getRuntimeTier();
    const tierResult = evaluateTierReadiness(tier, snapshot);

    return [
      symbol,
      {
        bias: ctx.structure.lastBias,
        swings: ctx.structure.lastSwings.slice(-5),
        breaks: ctx.structure.lastBreaks.slice(-3),
        fvgs: ctx.smc.lastFVGs,
        orderBlocks: ctx.smc.lastOBs,
        sweeps: ctx.smc.lastSweeps.slice(-3),
        activeSweep: ctx.smc.activeSweep ?? null,
        sweepMetrics: ctx.smc.activeSweepMetrics(),
        displacement: ctx.smc.lastDisplacement,
        breakerBlocks: ctx.smc.lastBreakers,
        inducements: ctx.smc.lastInducements,
        premiumDiscount: pd,
        tierReadiness: {
          currentTier: tier,
          conditions: (() => {
            const reqs = TIER_REQUIREMENTS[tier];
            const conditionNames: Array<{ key: keyof typeof reqs; label: string }> = [
              { key: "htfBias", label: "HTF Bias" },
              { key: "obOrFvgZone", label: "OB/FVG Zone" },
              { key: "sweep", label: "Sweep" },
              { key: "displacement", label: "Displacement" },
              { key: "bos", label: "BOS" },
              { key: "breaker", label: "Breaker" },
              { key: "inducement", label: "Inducement" },
              { key: "premiumDiscount", label: "Prem/Discount" },
            ];
            return conditionNames
              .filter(({ key }) => reqs[key] !== "ignored")
              .map(({ key, label }) => ({
                name: label,
                met: tierResult.met.includes(key),
                required: reqs[key] === "required",
              }));
          })(),
          readiness: tierResult.readiness,
        },
      },
    ];
  })
),
```

- [ ] **Step 6: Verify lint passes**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 7: Run full test suite**

Run: `npm run build && node --test dist/**/*.test.js`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/main.ts
git commit -m "feat: build SMC snapshot, add tier API endpoints, extend state payload"
```

---

## Chunk 4: Dashboard UI

### Task 11: Update dashboard types and add tier selector

**Files:**
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Update TypeScript interfaces**

Add/update interfaces in `App.tsx`:

```typescript
type AggressionTier = "aggressive" | "moderate" | "conservative";

interface BreakerBlockData {
  type: string;
  top: number;
  bottom: number;
  originalObType: string;
  isMitigated: boolean;
}

interface InducementData {
  type: string;
  level: number;
  isSwept: boolean;
}

interface PremiumDiscountData {
  swingHigh: number;
  swingLow: number;
  equilibrium: number;
  zone: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
  percentile: number;
}

interface TierCondition {
  name: string;
  met: boolean;
  required: boolean;
}

interface TierReadiness {
  currentTier: AggressionTier;
  conditions: TierCondition[];
  readiness: { aggressive: number; moderate: number; conservative: number };
}
```

Update `SmcSymbolData` to include new fields:

```typescript
interface SmcSymbolData {
  // ... existing fields ...
  breakerBlocks: BreakerBlockData[];
  inducements: InducementData[];
  premiumDiscount: PremiumDiscountData | null;
  tierReadiness: TierReadiness;
}
```

- [ ] **Step 2: Add tier state and selector component**

Add state for tier:

```typescript
const [currentTier, setCurrentTier] = useState<AggressionTier>("moderate");
```

Add useEffect to fetch initial tier on mount:

```typescript
useEffect(() => {
  const apiHost = import.meta.env.VITE_ARES_API_URL ?? 'http://localhost:3001';
  fetch(`${apiHost}/api/config/tier`)
    .then(r => r.json())
    .then(data => { if (data.tier) setCurrentTier(data.tier); })
    .catch(() => {});
}, []);
```

Add the tier selector component:

```typescript
const TierSelector = ({ current, onChange }: { current: AggressionTier; onChange: (t: AggressionTier) => void }) => {
  const tiers: AggressionTier[] = ["aggressive", "moderate", "conservative"];

  // Full class strings — Tailwind purges dynamic class names, so we must use complete literals
  const activeClasses: Record<AggressionTier, string> = {
    aggressive: "bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40 shadow-lg shadow-rose-500/10",
    moderate: "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40 shadow-lg shadow-amber-500/10",
    conservative: "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40 shadow-lg shadow-emerald-500/10",
  };

  const handleClick = async (tier: AggressionTier) => {
    const apiHost = import.meta.env.VITE_ARES_API_URL ?? 'http://localhost:3001';
    try {
      const res = await fetch(`${apiHost}/api/config/tier?level=${tier}`, { method: 'POST' });
      if (res.ok) onChange(tier);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex items-center gap-1">
      {tiers.map(t => (
        <button
          key={t}
          onClick={() => handleClick(t)}
          className={`px-3 py-1 rounded text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
            t === current ? activeClasses[t] : 'bg-white/5 text-slate-600 hover:text-slate-400'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
};
```

- [ ] **Step 3: Place tier selector in header**

In the header, after the system status pill and before the clock, add:

```tsx
<TierSelector current={currentTier} onChange={setCurrentTier} />
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/App.tsx
git commit -m "feat: add tier selector to dashboard header"
```

---

### Task 12: Add readiness checklist and meter to dashboard

**Files:**
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Create ReadinessChecklist component**

```typescript
const ReadinessChecklist = ({ conditions, tier }: { conditions: TierCondition[]; tier: AggressionTier }) => (
  <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[10px]">
    {conditions.map((c) => (
      <div key={c.name} className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${
          c.met
            ? 'bg-emerald-500 shadow-[0_0_4px_#10b981]'
            : c.required
              ? 'bg-rose-500/60'
              : 'bg-slate-700'
        }`} />
        <span className={c.met ? 'text-slate-300' : c.required ? 'text-rose-400/60' : 'text-slate-600'}>
          {c.name}
        </span>
      </div>
    ))}
  </div>
);
```

- [ ] **Step 2: Create ReadinessMeter component**

```typescript
const ReadinessMeter = ({ readiness }: { readiness: { aggressive: number; moderate: number; conservative: number } }) => {
  const tiers: { name: string; value: number; color: string }[] = [
    { name: "AGG", value: readiness.aggressive, color: "rose" },
    { name: "MOD", value: readiness.moderate, color: "amber" },
    { name: "CON", value: readiness.conservative, color: "emerald" },
  ];

  const barColor = (pct: number) =>
    pct >= 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-emerald-500/70' : pct >= 30 ? 'bg-amber-500/70' : 'bg-rose-500/70';

  return (
    <div className="flex flex-col gap-1">
      {tiers.map(t => (
        <div key={t.name} className="flex items-center gap-2">
          <span className="text-[9px] font-bold text-slate-500 w-6">{t.name}</span>
          <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${barColor(t.value)}`}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(t.value, 100)}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <span className={`text-[9px] font-mono w-8 text-right ${t.value >= 100 ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
            {t.value >= 100 ? 'RDY' : `${t.value}%`}
          </span>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 3: Add new columns to SmcPanel for breakers, inducements, and premium/discount**

Update the `SmcPanel` component. After the existing 3-column grid section for FVGs/OBs/Sweeps, change `grid-cols-3` to `grid-cols-5` and add:

```tsx
{/* Breaker Blocks */}
<div>
  <span className="text-slate-500 font-bold uppercase block mb-1">Breakers</span>
  {(!d.breakerBlocks || d.breakerBlocks.length === 0) ? (
    <span className="text-slate-600">None</span>
  ) : d.breakerBlocks.map((b, i) => (
    <div key={i} className={`flex items-center gap-1 ${b.type === 'BULLISH' ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>
      <span className="font-mono">{b.bottom.toFixed(2)}-{b.top.toFixed(2)}</span>
    </div>
  ))}
</div>

{/* Inducements */}
<div>
  <span className="text-slate-500 font-bold uppercase block mb-1">Inducement</span>
  {(!d.inducements || d.inducements.length === 0) ? (
    <span className="text-slate-600">None</span>
  ) : d.inducements.map((ind, i) => (
    <div key={i} className={`${ind.isSwept ? 'text-amber-400' : 'text-slate-500'}`}>
      <span className="font-mono">{ind.type.replace('_INDUCEMENT', '')} @{ind.level.toFixed(2)}</span>
      {ind.isSwept && <span className="ml-1 text-[9px] text-amber-500">SWEPT</span>}
    </div>
  ))}
</div>
```

Add premium/discount tag next to the symbol name in the SmcPanel per-symbol header:

```tsx
{d.premiumDiscount && (
  <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
    d.premiumDiscount.zone === 'DISCOUNT'
      ? 'bg-emerald-500/10 text-emerald-400'
      : d.premiumDiscount.zone === 'PREMIUM'
        ? 'bg-rose-500/10 text-rose-400'
        : 'bg-slate-500/10 text-slate-400'
  }`}>
    {d.premiumDiscount.zone} {d.premiumDiscount.percentile}%
  </span>
)}
```

Add readiness checklist and meter after the grid, inside each symbol's section:

```tsx
{d.tierReadiness && (
  <div className="mt-3 pt-3 border-t border-white/5 flex flex-col gap-2">
    <ReadinessChecklist conditions={d.tierReadiness.conditions} tier={d.tierReadiness.currentTier} />
    <ReadinessMeter readiness={d.tierReadiness.readiness} />
  </div>
)}
```

- [ ] **Step 4: Verify dashboard builds**

Run: `cd dashboard && npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/App.tsx
git commit -m "feat: add readiness checklist, meter, breakers, inducement, premium/discount to dashboard"
```

---

## Chunk 5: Final Verification

### Task 13: Full build and test verification

- [ ] **Step 1: Run full lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 2: Run full test suite**

Run: `npm run build && node --test dist/**/*.test.js`
Expected: All tests pass

- [ ] **Step 3: Build dashboard**

Run: `cd dashboard && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Update .env with new variable**

Ensure local `.env` has `SMC_AGGRESSION=moderate`

- [ ] **Step 5: Smoke test — start engine in paper mode**

Run: `npm run dev` (or `TRADING_MODE=paper npm run dev`)
Verify in logs:
- No crash on boot
- `[ARES.API] State server listening on 0.0.0.0:3001`
- Tier API responds: `curl http://localhost:3001/api/config/tier`

- [ ] **Step 6: Smoke test — tier API**

```bash
curl http://localhost:3001/api/config/tier
# Expected: {"tier":"moderate"}

curl -X POST "http://localhost:3001/api/config/tier?level=aggressive"
# Expected: {"tier":"aggressive"}

curl http://localhost:3001/api/config/tier
# Expected: {"tier":"aggressive"}
```

- [ ] **Step 7: Smoke test — dashboard**

Open dashboard, verify:
- Tier selector visible in header
- SmcPanel shows breakers/inducement columns
- Premium/discount tags appear
- Readiness checklist and meter render per symbol

- [ ] **Step 8: Final commit (if any remaining changes)**

Only commit if there are unstaged fixes from smoke testing:

```bash
git status
# If changes exist, stage specific files:
# git add src/... dashboard/...
# git commit -m "chore: smoke test fixes"
```
