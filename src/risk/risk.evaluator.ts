import { calculatePositionSize } from "./position.sizer.js";
import { checkExposure } from "./exposure.guard.js";
import { checkLeverage } from "./leverage.guard.js";
import { RiskContext, TradeRiskInput } from "./types.js";

export function evaluateRisk(
  ctx: RiskContext,
  trade: TradeRiskInput
): { allowed: true; qty: number } | { allowed: false; reason: string } {
  const exposureFail = checkExposure(ctx);
  if (exposureFail) {
    console.warn(`[ARES.RISK] Blocked by exposure guard: ${exposureFail}`);
    return { allowed: false, reason: exposureFail };
  }

  const size = calculatePositionSize(ctx.balance, trade);
  if (!size) {
    console.warn("[ARES.RISK] Blocked: POSITION_SIZE_TOO_SMALL");
    return { allowed: false, reason: "POSITION_SIZE_TOO_SMALL" };
  }

  const notional = size.qty * trade.entryPrice;
  const leverageFail = checkLeverage(notional, ctx.balance);
  if (leverageFail) {
    console.warn(`[ARES.RISK] Blocked by leverage guard: ${leverageFail}`);
    return { allowed: false, reason: leverageFail };
  }

  console.info(`[ARES.RISK] Allowed qty=${size.qty}`);
  return { allowed: true, qty: size.qty };
}
