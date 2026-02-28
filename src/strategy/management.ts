import { Position } from "../state/position.store.js";
import { StructureAnalyzer } from "./structure.js";

export interface ManagementAction {
  type: "CLOSE" | "UPDATE_SL";
  newStop?: number;
  reason: string;
}

/**
 * Professional Position Manager
 * Decisions:
 * 1. Structural Invalidation: Exit if CHoCH occurs against the direction.
 * 2. Break-Even: Move SL to Entry at 1:1 RR.
 * 3. Trailing Stop: Follow the latest Swing Points once in profit.
 */
export function managePosition(
  pos: Position,
  currentPrice: number,
  structure: StructureAnalyzer
): ManagementAction | null {
  if (!pos.stopPrice) return null;

  const isLong = pos.side === "LONG";
  const entry = pos.entryPrice;
  const breakEvenTriggerRR = 1.0;

  // 1. Structural Invalidation
  // If we see a CHoCH in the opposite direction, the setup is likely dead.
  const lastBreak = structure.lastBreaks.at(-1);
  if (lastBreak && lastBreak.type === "CHOCH") {
    if (isLong && lastBreak.side === "DOWN") {
      return { type: "CLOSE", reason: "Bearish CHoCH (Structural Invalidation)" };
    }
    if (!isLong && lastBreak.side === "UP") {
      return { type: "CLOSE", reason: "Bullish CHoCH (Structural Invalidation)" };
    }
  }

  // 2. Break-Even Logic
  const risk = Math.abs(entry - pos.stopPrice);
  const profit = isLong ? currentPrice - entry : entry - currentPrice;
  const isAlreadyAtOrAboveBE = isLong ? pos.stopPrice >= entry : pos.stopPrice <= entry;

  if (!isAlreadyAtOrAboveBE && risk > 0 && profit >= risk * breakEvenTriggerRR) {
    return {
      type: "UPDATE_SL",
      newStop: entry,
      reason: "Reached 1:1 RR; moving to Break-Even",
    };
  }

  // 3. Trailing Stops (Follow Swings)
  // Only trailing if we are firmly in profit and a new swing point is confirmed.
  if (profit > risk) {
    if (isLong) {
      const lastLow = structure.lastSwings.filter((s) => s.type === "LOW").at(-1);
      if (
        lastLow &&
        lastLow.price > pos.stopPrice &&
        lastLow.price < currentPrice &&
        lastLow.price > entry
      ) {
        return {
          type: "UPDATE_SL",
          newStop: lastLow.price,
          reason: "Trailing SL behind confirmed Swing Low",
        };
      }
    } else {
      const lastHigh = structure.lastSwings.filter((s) => s.type === "HIGH").at(-1);
      if (
        lastHigh &&
        lastHigh.price < pos.stopPrice &&
        lastHigh.price > currentPrice &&
        lastHigh.price < entry
      ) {
        return {
          type: "UPDATE_SL",
          newStop: lastHigh.price,
          reason: "Trailing SL behind confirmed Swing High",
        };
      }
    }
  }

  return null;
}
