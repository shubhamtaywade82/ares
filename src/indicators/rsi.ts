import { RSI } from "technicalindicators";
import { DeltaCandle } from "../delta/types.js";

export function computeRSI(
  candles: readonly DeltaCandle[],
  period = 14
): number | undefined {
  if (candles.length < period + 1) return undefined;

  const closes = candles.map((c) => c.close);
  const values = RSI.calculate({ period, values: closes });

  return values.at(-1);
}
