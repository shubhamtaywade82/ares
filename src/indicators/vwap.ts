import tulind from "tulind";
import { DeltaCandle } from "../delta/types.js";

export async function computeVWAP(
  candles: readonly DeltaCandle[]
): Promise<number | undefined> {
  if (candles.length < 2) return undefined;

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  return new Promise((resolve, reject) => {
    tulind.indicators.vwap.indicator(
      [highs, lows, closes, volumes],
      [],
      (err, res) => {
        if (err) return reject(err);
        resolve(res[0].at(-1));
      }
    );
  });
}
