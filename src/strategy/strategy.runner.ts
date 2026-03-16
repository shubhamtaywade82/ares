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
};

export const runStrategy = async (
  market: MarketCache,
  indicators: IndicatorCache,
  structure?: StructureAnalyzer,
  smc?: SmcAnalyzer,
  smcSnapshot?: SmcStateSnapshot
): Promise<StrategyResult | null> => {
  if (!indicators.isReady("15m") || !indicators.isReady("5m")) {
    logger.debug(
      `[ARES.STRATEGY] Indicators not ready (15m: ${indicators.isReady("15m")}, 5m: ${indicators.isReady("5m")})`
    );
    return null;
  }

  const bias = computeHTFBias(market, indicators, structure);
  if (bias === "NONE") {
    logger.debug("[ARES.STRATEGY] Bias is NONE");
    return null;
  }

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
  const setup = detectLTFSetup(
    bias,
    market,
    indicators,
    structure,
    smc,
    tier,
    premiumDiscount
  );
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
        tierReadiness:
          tierReadiness ??
          evaluateTierReadiness(tier, smcSnapshot ?? EMPTY_SNAPSHOT),
      };
    }
    logger.debug("[ARES.STRATEGY] Setup score below threshold");
    return null;
  }
  logger.debug(`[ARES.STRATEGY] Setup scored=${scored.score}`);

  return {
    setup: scored,
    tierReadiness:
      tierReadiness ??
      evaluateTierReadiness(tier, smcSnapshot ?? EMPTY_SNAPSHOT),
  };
};
