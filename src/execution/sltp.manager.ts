import { ExecutionSide } from "./types.js";

export function computeTargets(
  entry: number,
  stop: number,
  side: ExecutionSide,
  rr = 2
): number {
  const risk = Math.abs(entry - stop);

  return side === "LONG" ? entry + risk * rr : entry - risk * rr;
}
