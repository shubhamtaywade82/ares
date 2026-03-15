import { AggressionTier } from "../config/runtime.js";
import { PremiumDiscount } from "./structure.js";

export type { AggressionTier } from "../config/runtime.js";

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
  aggressive: { breaker: 2, inducement: 1, premiumDiscount: 2 },
  moderate: { breaker: 2, inducement: 1, premiumDiscount: 2 },
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
  const required = ALL_CONDITIONS.filter((c) => reqs[c] === "required");
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
