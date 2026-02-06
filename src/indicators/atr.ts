import tulind from "tulind";
import { DeltaCandle } from "../delta/types.js";

export async function computeATR(
  candles: readonly DeltaCandle[],
  period = 14
): Promise<number | undefined> {
  if (candles.length < period + 1) return undefined;

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);

  return new Promise((resolve, reject) => {
    tulind.indicators.atr.indicator(
      [highs, lows, closes],
      [period],
      (err, res) => {
        if (err) return reject(err);
        resolve(res[0].at(-1));
      }
    );
  });
}
