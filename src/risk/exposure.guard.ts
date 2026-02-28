import { RISK_CONFIG } from "../config/risk.js";
import { KillSwitch } from "./kill.switch.js";
import { KillReason } from "./kill.reasons.js";
import { RiskContext } from "./types.js";

export function checkExposure(ctx: RiskContext, symbol: string): string | null {
  if (ctx.openTrades >= RISK_CONFIG.maxOpenTradesTotal) {
    return "MAX_OPEN_TRADES_REACHED";
  }

  const symbolKey = symbol.toUpperCase();
  const openForSymbol = ctx.openTradesBySymbol[symbolKey] ?? 0;
  if (openForSymbol >= RISK_CONFIG.maxOpenTradesPerSymbol) {
    return "MAX_OPEN_TRADES_PER_SYMBOL_REACHED";
  }

  const dailyLossPct = Math.abs(ctx.dailyPnl) / ctx.equity;

  if (ctx.dailyPnl < 0 && dailyLossPct >= RISK_CONFIG.maxDailyLossPct) {
    KillSwitch.trigger(KillReason.MAX_DAILY_LOSS, {
      dailyPnl: ctx.dailyPnl,
      equity: ctx.equity,
      available: ctx.availableBalance,
      dailyLossPct,
    });
    return "MAX_DAILY_LOSS_BREACHED";
  }

  return null;
}
