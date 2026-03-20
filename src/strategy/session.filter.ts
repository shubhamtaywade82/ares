/**
 * Session filter utility — derived from live 5-min data analysis (2026-03-20).
 *
 * Live data findings (500 bars, 3.5 days):
 *   - Asia session (01–08 UTC): win rate 41–49%, negative avg return
 *   - London session (08–13 UTC): win rate 40–45%, MOST negative avg return
 *   - NY session (13–20 UTC): win rate 46–50%, best win rate across all 4 pairs
 *
 * Recommendation: block all new entries during London (08–13 UTC), allow
 * aggressive entries during NY (13–20 UTC).
 */

export type TradingSession = "ASIA" | "LONDON" | "NY" | "CLOSED";

/**
 * Returns the current trading session based on UTC hour.
 * Derived from live 5-min candle session breakdown.
 */
export const getCurrentSession = (nowMs: number = Date.now()): TradingSession => {
  const h = new Date(nowMs).getUTCHours();
  if (h >= 1 && h < 8) return "ASIA";
  if (h >= 8 && h < 13) return "LONDON";
  if (h >= 13 && h < 20) return "NY";
  return "CLOSED";
};

/**
 * Session-aware entry gate.
 *
 * Returns true (allow entry) based on session rules derived from live data:
 *   - NY: always allowed (best win rate)
 *   - Asia: allowed but use conservative tier only
 *   - London: BLOCKED (lowest win rate, most negative avg return)
 *   - Closed: blocked
 */
export const isEntryAllowedBySession = (
  nowMs: number = Date.now(),
  options: { blockLondon?: boolean; blockAsia?: boolean } = {}
): { allowed: boolean; session: TradingSession; reason: string } => {
  const session = getCurrentSession(nowMs);
  const blockLondon = options.blockLondon ?? true;   // default: block London
  const blockAsia   = options.blockAsia  ?? false;   // default: allow Asia (conservative)

  if (session === "NY") {
    return { allowed: true, session, reason: "NY session — best win rate (46–50%)" };
  }
  if (session === "LONDON" && blockLondon) {
    return { allowed: false, session, reason: "London session blocked — lowest win rate (40–45%)" };
  }
  if (session === "ASIA" && blockAsia) {
    return { allowed: false, session, reason: "Asia session blocked" };
  }
  if (session === "CLOSED") {
    return { allowed: false, session, reason: "Market closed (20–01 UTC)" };
  }
  return { allowed: true, session, reason: `${session} session allowed (conservative)` };
};

/**
 * RSI entry quality check.
 * Data shows RSI 70–73 across all pairs — overbought. Avoid new LONG entries.
 * Returns whether the current RSI is appropriate for the intended side.
 *
 * @param rsi - Current 14-period RSI value
 * @param side - Intended trade direction
 */
export const isRsiEntryValid = (
  rsi: number,
  side: "LONG" | "SHORT"
): { valid: boolean; reason: string } => {
  if (side === "LONG") {
    if (rsi > 65) return { valid: false, reason: `RSI ${rsi.toFixed(1)} > 65 — overbought, avoid LONG` };
    if (rsi < 40) return { valid: true, reason: `RSI ${rsi.toFixed(1)} — oversold reversal LONG` };
    return { valid: true, reason: `RSI ${rsi.toFixed(1)} — neutral LONG ok` };
  }
  // SHORT
  if (rsi < 35) return { valid: false, reason: `RSI ${rsi.toFixed(1)} < 35 — oversold, avoid SHORT` };
  if (rsi > 65) return { valid: true, reason: `RSI ${rsi.toFixed(1)} — overbought reversal SHORT` };
  return { valid: true, reason: `RSI ${rsi.toFixed(1)} — neutral SHORT ok` };
};
