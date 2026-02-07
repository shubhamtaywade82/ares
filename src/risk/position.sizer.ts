import { RISK_CONFIG, resolveMaxLeverage } from "../config/risk.js";
import { TradeRiskInput, PositionSizeResult } from "./types.js";

export function calculatePositionSize(
  balance: number,
  input: TradeRiskInput
): PositionSizeResult | null {
  const riskAmount = balance * RISK_CONFIG.riskPerTradePct;
  const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
  const maxLeverage = resolveMaxLeverage(input.symbol);

  if (stopDistance <= 0) return null;

  const rawQty = riskAmount / stopDistance;
  const maxNotional = balance * maxLeverage;
  const maxQty = maxNotional / input.entryPrice;
  const sizedQty = Math.min(rawQty, maxQty);
  console.info(
    `[ARES.RISK] PositionSize balance=${balance} riskAmount=${riskAmount} stopDistance=${stopDistance} rawQty=${rawQty} maxLeverage=${maxLeverage} maxQty=${maxQty} minLotSize=${input.minLotSize}`
  );

  if (sizedQty < input.minLotSize) return null;

  return {
    qty: Math.floor(sizedQty / input.minLotSize) * input.minLotSize,
    riskAmount,
    stopDistance,
  };
}
