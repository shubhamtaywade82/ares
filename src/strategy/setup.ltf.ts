import { MarketCache } from "../market/market.cache.js";
import { IndicatorCache } from "../indicators/indicator.cache.js";
import { Bias, SetupSignal } from "./types.js";
import { StructureAnalyzer } from "./structure.js";
import { SmcAnalyzer } from "./smc.js";
import { detectPattern } from "./patterns.js";

export function detectLTFSetup(
  bias: Bias,
  market: MarketCache,
  indicators: IndicatorCache,
  structure?: StructureAnalyzer,
  smc?: SmcAnalyzer
): SetupSignal | null {
  if (bias === "NONE") return null;

  const candles = market.candles("5m");
  const ind = indicators.snapshot("5m");

  if (!ind.ready || candles.length < 2) return null;
  if (ind.atr14 === undefined) return null;

  const last = candles.at(-1)!;
  const reasons: string[] = [];
  let score = 0;

  // 1. Price Action Pattern Confirmation
  const pattern = detectPattern(candles);
  if (pattern) {
    if (bias === "LONG" && (pattern.type === "ENGULFING_BULL" || pattern.type === "PIN_BAR_BULL")) {
      score += 4;
      reasons.push(`Price Action: ${pattern.type}`);
    } else if (bias === "SHORT" && (pattern.type === "ENGULFING_BEAR" || pattern.type === "PIN_BAR_BEAR")) {
      score += 4;
      reasons.push(`Price Action: ${pattern.type}`);
    }
  }

  // 2. SMC Zone Confluence
  if (smc) {
    const obs = smc.lastOBs;
    const fvgs = smc.lastFVGs;

    if (bias === "LONG") {
      const inOB = obs.find(ob => ob.type === "BULLISH" && last.low <= ob.top && last.high >= ob.bottom);
      const inFVG = fvgs.find(f => f.type === "BULLISH" && last.low <= f.top && last.high >= f.bottom);
      if (inOB) { score += 3; reasons.push("In Bullish Order Block"); }
      if (inFVG) { score += 3; reasons.push("In Bullish FVG"); }
    } else {
      const inOB = obs.find(ob => ob.type === "BEARISH" && last.high >= ob.bottom && last.low <= ob.top);
      const inFVG = fvgs.find(f => f.type === "BEARISH" && last.high >= f.bottom && last.low <= f.top);
      if (inOB) { score += 3; reasons.push("In Bearish Order Block"); }
      if (inFVG) { score += 3; reasons.push("In Bearish FVG"); }
    }
  }

  // 3. Fallback: Traditional Pullback Confluence
  if (ind.ema20 !== undefined && ind.vwap !== undefined) {
    const nearValue = Math.abs(last.close - ind.ema20) <= ind.atr14 * 0.5 || Math.abs(last.close - ind.vwap) <= ind.atr14 * 0.5;
    if (nearValue) {
      score += 2;
      reasons.push("Pullback to technical value");
    }
  }

  if (score === 0) return null;

  return { side: bias === "LONG" ? "LONG" : "SHORT", score, reasons };
}
