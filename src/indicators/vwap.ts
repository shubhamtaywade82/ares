import tulind from "tulind";
import { DeltaCandle } from "../delta/types.js";

const VWAP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function computeVWAP(
  candles: readonly DeltaCandle[]
): Promise<number | undefined> {
  if (candles.length < 2) return undefined;

  // Use a 24h rolling window so VWAP stays a meaningful mean-reversion anchor;
  // on cold start or very short sessions fall back to the full array.
  const windowStart = Date.now() - VWAP_WINDOW_MS;
  const windowed = candles.filter((c) => c.timestamp >= windowStart);
  const src = windowed.length >= 2 ? windowed : candles;

  const highs = src.map((c) => c.high);
  const lows = src.map((c) => c.low);
  const closes = src.map((c) => c.close);
  const volumes = src.map((c) => c.volume);

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
  for (const c of src) {
    const typical = (c.high + c.low + c.close) / 3;
    totalPV += typical * c.volume;
    totalVolume += c.volume;
  }

  if (totalVolume <= 0) return undefined;
  return totalPV / totalVolume;
}
