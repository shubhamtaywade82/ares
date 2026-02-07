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

  const vwapIndicator = tulind?.indicators?.vwap?.indicator;
  if (typeof vwapIndicator === "function") {
    return new Promise((resolve, reject) => {
      vwapIndicator([highs, lows, closes, volumes], [], (err, res) => {
        if (err) return reject(err);
        const series = res[0];
        resolve(series ? series.at(-1) : undefined);
      });
    });
  }

  let totalPV = 0;
  let totalVolume = 0;
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    const typical = (c.high + c.low + c.close) / 3;
    totalPV += typical * c.volume;
    totalVolume += c.volume;
  }

  if (totalVolume <= 0) return undefined;
  return totalPV / totalVolume;
}
