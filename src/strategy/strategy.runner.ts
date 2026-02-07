import { MarketCache } from "../market/market.cache.js";
import { IndicatorCache } from "../indicators/indicator.cache.js";
import { computeHTFBias } from "./bias.htf.js";
import { detectLTFSetup } from "./setup.ltf.js";
import { scoreSetup } from "./scorer.js";
import { SetupSignal } from "./types.js";

export async function runStrategy(
  market: MarketCache,
  indicators: IndicatorCache
): Promise<SetupSignal | null> {
  // Hard readiness checks
  if (!indicators.isReady("15m") || !indicators.isReady("5m")) {
    console.info("[ARES.STRATEGY] Indicators not ready (5m/15m)");
    return null;
  }

  const bias = computeHTFBias(market, indicators);
  if (bias === "NONE") {
    console.info("[ARES.STRATEGY] HTF bias is NONE");
    return null;
  }
  console.info(`[ARES.STRATEGY] HTF bias=${bias}`);

  const setup = detectLTFSetup(bias, market, indicators);
  if (!setup) {
    console.info("[ARES.STRATEGY] No LTF setup detected");
    return null;
  }

  const scored = scoreSetup(setup, indicators.snapshot("15m"));
  console.info(`[ARES.STRATEGY] Setup scored=${scored.score}`);

  return scored;
}
