import { EMA } from "technicalindicators";
import { DeltaCandle } from "../delta/types.js";

export function computeEMA(
  candles: readonly DeltaCandle[],
  period: number
): number | undefined {
  if (candles.length < period) return undefined;

  const closes = candles.map((c) => c.close);
  const values = EMA.calculate({ period, values: closes });

  return values.at(-1);
}
