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
