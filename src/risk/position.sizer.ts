import { RISK_CONFIG } from "../config/risk.js";
import { TradeRiskInput, PositionSizeResult } from "./types.js";

export function calculatePositionSize(
  balance: number,
  input: TradeRiskInput
): PositionSizeResult | null {
  const riskAmount = balance * RISK_CONFIG.riskPerTradePct;
  const stopDistance = Math.abs(input.entryPrice - input.stopPrice);

  if (stopDistance <= 0) return null;

  const rawQty = riskAmount / stopDistance;
  console.info(
    `[ARES.RISK] PositionSize balance=${balance} riskAmount=${riskAmount} stopDistance=${stopDistance} rawQty=${rawQty} minLotSize=${input.minLotSize}`
  );

  if (rawQty < input.minLotSize) return null;

  return {
    qty: Math.floor(rawQty / input.minLotSize) * input.minLotSize,
    riskAmount,
    stopDistance,
  };
}
