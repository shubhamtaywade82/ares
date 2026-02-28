import { DeltaCandle } from "../delta/types.js";

export type StructureType = "BOS" | "CHOCH";
export type StructuralBias = "BULLISH" | "BEARISH" | "SIDEWAYS";

export interface SwingPoint {
  type: "HIGH" | "LOW";
  price: number;
  index: number;
  timestamp: number;
}

export interface StructureBreak {
  type: StructureType;
  side: "UP" | "DOWN";
  price: number;
  timestamp: number;
}

export class StructureAnalyzer {
  private swings: SwingPoint[] = [];
  private breaks: StructureBreak[] = [];
  private bias: StructuralBias = "SIDEWAYS";

  constructor(private lookback = 2) {}

  update(candles: readonly DeltaCandle[]) {
    if (candles.length < this.lookback * 2 + 1) return;

    this.detectSwings(candles);
    this.detectBreaks(candles);
    this.updateBias();
  }

  get lastBias(): StructuralBias {
    return this.bias;
  }

  get lastSwings(): SwingPoint[] {
    return this.swings.slice(-10);
  }

  get lastBreaks(): StructureBreak[] {
    return this.breaks.slice(-5);
  }

  private detectSwings(candles: readonly DeltaCandle[]) {
    const i = candles.length - 1 - this.lookback;
    const current = candles[i];
    if (!current) return;

    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= this.lookback; j++) {
      const p = candles[i - j];
      const n = candles[i + j];
      if (!p || !n) {
        isHigh = false;
        isLow = false;
        break;
      }
      if (p.high >= current.high || n.high > current.high) {
        isHigh = false;
      }
      if (p.low <= current.low || n.low < current.low) {
        isLow = false;
      }
    }

    if (isHigh) {
      this.addSwing({ type: "HIGH", price: current.high, index: i, timestamp: current.timestamp });
    }
    if (isLow) {
      this.addSwing({ type: "LOW", price: current.low, index: i, timestamp: current.timestamp });
    }
  }

  private addSwing(point: SwingPoint) {
    const last = this.swings.at(-1);
    if (last && last.type === point.type && Math.abs(last.index - point.index) < 2) {
      if (point.type === "HIGH" && point.price > last.price) {
        this.swings[this.swings.length - 1] = point;
      } else if (point.type === "LOW" && point.price < last.price) {
        this.swings[this.swings.length - 1] = point;
      }
      return;
    }
    this.swings.push(point);
    if (this.swings.length > 100) this.swings.shift();
  }

  private detectBreaks(candles: readonly DeltaCandle[]) {
    if (this.swings.length < 2) return;
    const lastCandle = candles.at(-1);
    if (!lastCandle) return;

    const lastHigh = this.swings.filter(s => s.type === "HIGH").at(-1);
    const lastLow = this.swings.filter(s => s.type === "LOW").at(-1);

    if (lastHigh && lastCandle.close > lastHigh.price) {
      const type: StructureType = this.bias === "BEARISH" ? "CHOCH" : "BOS";
      this.addBreak({ type, side: "UP", price: lastHigh.price, timestamp: lastCandle.timestamp });
    }

    if (lastLow && lastCandle.close < lastLow.price) {
      const type: StructureType = this.bias === "BULLISH" ? "CHOCH" : "BOS";
      this.addBreak({ type, side: "DOWN", price: lastLow.price, timestamp: lastCandle.timestamp });
    }
  }

  private addBreak(brk: StructureBreak) {
    const last = this.breaks.at(-1);
    if (last && last.type === brk.type && last.side === brk.side && Math.abs(last.timestamp - brk.timestamp) < 60000) {
      return;
    }
    this.breaks.push(brk);
    if (this.breaks.length > 50) this.breaks.shift();
  }

  private updateBias() {
    const lastBreak = this.breaks.at(-1);
    if (!lastBreak) return;

    if (lastBreak.side === "UP") {
      this.bias = "BULLISH";
    } else {
      this.bias = "BEARISH";
    }
  }
}
