import { RISK_CONFIG } from "../config/risk.js";
import { KillSwitch } from "./kill.switch.js";
import { KillReason } from "./kill.reasons.js";
import { RiskContext } from "./types.js";

export function checkExposure(ctx: RiskContext): string | null {
  if (ctx.openTrades >= RISK_CONFIG.maxOpenTrades) {
    return "MAX_OPEN_TRADES_REACHED";
  }

  const dailyLossPct = Math.abs(ctx.dailyPnl) / ctx.balance;

  if (ctx.dailyPnl < 0 && dailyLossPct >= RISK_CONFIG.maxDailyLossPct) {
    KillSwitch.trigger(KillReason.MAX_DAILY_LOSS, {
      dailyPnl: ctx.dailyPnl,
      balance: ctx.balance,
      dailyLossPct,
    });
    return "MAX_DAILY_LOSS_BREACHED";
  }

  return null;
}
