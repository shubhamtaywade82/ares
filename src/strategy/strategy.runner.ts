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

export async function runStrategy(
  market: MarketCache,
  indicators: IndicatorCache,
  structure?: StructureAnalyzer,
  smc?: SmcAnalyzer
): Promise<SetupSignal | null> {
  // Hard readiness checks
  if (!indicators.isReady("15m") || !indicators.isReady("5m")) {
    return null;
  }

  const bias = computeHTFBias(market, indicators, structure);
  if (bias === "NONE") return null;

  const setup = detectLTFSetup(bias, market, indicators, structure, smc);
  if (!setup) return null;

  const scored = scoreSetup(setup, indicators.snapshot("15m"));
  if (!scored) {
    if (env.TRADING_MODE === "paper" && env.PAPER_BYPASS_SCORE) {
      logger.warn("[ARES.STRATEGY] Score below threshold; bypassing in paper");
      return setup;
    }
    logger.info("[ARES.STRATEGY] Setup score below threshold");
    return null;
  }
  logger.info(`[ARES.STRATEGY] Setup scored=${scored.score}`);

  return scored;
}
