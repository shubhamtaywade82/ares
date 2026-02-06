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
    return null;
  }

  const bias = computeHTFBias(market, indicators);
  if (bias === "NONE") return null;

  const setup = detectLTFSetup(bias, market, indicators);
  if (!setup) return null;

  const scored = scoreSetup(setup, indicators.snapshot("15m"));

  return scored;
}
