import { calculatePositionSize } from "./position.sizer.js";
import { checkExposure } from "./exposure.guard.js";
import { checkLeverage } from "./leverage.guard.js";
import { RiskContext, TradeRiskInput } from "./types.js";
import { resolveMaxLeverage } from "../config/risk.js";
import { logger } from "../utils/logger.js";

export function evaluateRisk(
  ctx: RiskContext,
  trade: TradeRiskInput
): { allowed: true; qty: number } | { allowed: false; reason: string } {
  const exposureFail = checkExposure(ctx, trade.symbol);
  if (exposureFail) {
    console.warn(`[ARES.RISK] Blocked by exposure guard: ${exposureFail}`);
    return { allowed: false, reason: exposureFail };
  }

  const size = calculatePositionSize({
    equity: ctx.equity,
    availableBalance: ctx.availableBalance,
    ...trade,
  });
  if (!size) {
    logger.warn("[ARES.RISK] Blocked: POSITION_SIZE_TOO_SMALL");
    return { allowed: false, reason: "POSITION_SIZE_TOO_SMALL" };
  }

  const notionalUSD = size.qty * trade.entryPrice * trade.contractValue;
  const balanceUSD = ctx.availableBalance * trade.inrToUsd;
  const maxLeverage = resolveMaxLeverage(trade.symbol);
  const leverageFail = checkLeverage(notionalUSD, balanceUSD, maxLeverage);
  if (leverageFail) {
    logger.warn(`[ARES.RISK] Blocked by leverage guard: ${leverageFail}`);
    return { allowed: false, reason: leverageFail };
  }

  logger.info(`[ARES.RISK] Allowed qty=${size.qty}`);
  return { allowed: true, qty: size.qty };
}
