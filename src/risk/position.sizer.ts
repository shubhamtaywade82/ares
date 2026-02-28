import { RISK_CONFIG, resolveMaxLeverage } from "../config/risk.js";
import { logger } from "../utils/logger.js";
import { TradeRiskInput, PositionSizeResult } from "./types.js";

export function calculatePositionSize(
  balance: number,
  input: TradeRiskInput
): PositionSizeResult | null {
  const riskAmountINR = balance * RISK_CONFIG.riskPerTradePct;
  const riskAmountUSD = riskAmountINR * input.inrToUsd;
  const stopDistanceUSD = Math.abs(input.entryPrice - input.stopPrice);
  const maxLeverage = resolveMaxLeverage(input.symbol);

  if (stopDistanceUSD <= 0) return null;

  // qty = riskAmountUSD / (stopDistanceUSD * contractValue)
  const rawQty = riskAmountUSD / (stopDistanceUSD * input.contractValue);

  const maxNotionalUSD = balance * input.inrToUsd * maxLeverage;
  const maxQty = maxNotionalUSD / (input.entryPrice * input.contractValue);

  const sizedQty = Math.min(rawQty, maxQty);

  logger.info(
    `[ARES.RISK] PositionSize balanceINR=${balance} riskAmountUSD=${riskAmountUSD.toFixed(2)} stopDistUSD=${stopDistanceUSD.toFixed(2)} rawQty=${rawQty.toFixed(2)} maxQty=${maxQty.toFixed(2)} minLotSize=${input.minLotSize} cv=${input.contractValue}`
  );

  if (sizedQty < input.minLotSize) {
    logger.warn(
      `[ARES.RISK] Sized qty ${sizedQty.toFixed(4)} < minLotSize ${input.minLotSize} — blocking trade to avoid oversizing. (Maybe increase risk % or account balance?)`
    );
    return null;
  }

  return {
    qty: Math.floor(sizedQty / input.minLotSize) * input.minLotSize,
    riskAmount: riskAmountINR,
    stopDistance: stopDistanceUSD,
  };
}
