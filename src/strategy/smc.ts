import { DeltaCandle } from "../delta/types.js";
import { StructureBreak } from "./structure.js";

export interface FVG {
  type: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  timestamp: number;
  isFilled: boolean;
}

export interface OrderBlock {
  type: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  timestamp: number;
  volume: number;
  isMitigated: boolean;
}

export class SmcAnalyzer {
  private fvgs: FVG[] = [];
  private obs: OrderBlock[] = [];

  update(candles: readonly DeltaCandle[], breaks: StructureBreak[]) {
    this.detectFVGs(candles);
    this.detectOBs(candles, breaks);
    this.checkMitigation(candles);
  }

  get lastFVGs(): FVG[] {
    return this.fvgs.filter(f => !f.isFilled).slice(-5);
  }

  get lastOBs(): OrderBlock[] {
    return this.obs.filter(o => !o.isMitigated).slice(-5);
  }

  private detectFVGs(candles: readonly DeltaCandle[]) {
    if (candles.length < 3) return;

    const i = candles.length - 2;
    const p = candles[i - 1];
    const c = candles[i];
    const n = candles[i + 1];

    if (!p || !c || !n) return;

    if (n.low > p.high) {
      const fvg: FVG = {
        type: "BULLISH",
        bottom: p.high,
        top: n.low,
        timestamp: c.timestamp,
        isFilled: false
      };
      this.addFVG(fvg);
    }

    if (n.high < p.low) {
      const fvg: FVG = {
        type: "BEARISH",
        bottom: n.high,
        top: p.low,
        timestamp: c.timestamp,
        isFilled: false
      };
      this.addFVG(fvg);
    }
  }

  private addFVG(fvg: FVG) {
    const last = this.fvgs.at(-1);
    if (last && last.timestamp === fvg.timestamp && last.type === fvg.type) return;
    this.fvgs.push(fvg);
    if (this.fvgs.length > 50) this.fvgs.shift();
  }

  private detectOBs(candles: readonly DeltaCandle[], breaks: StructureBreak[]) {
    if (breaks.length === 0) return;
    const lastBreak = breaks.at(-1)!;

    const lastCandle = candles.at(-1);
    if (!lastCandle) return;

    const now = lastCandle.timestamp;
    if (now - lastBreak.timestamp > 300000) return;

    const breakIndex = candles.findIndex(c => c.timestamp === lastBreak.timestamp);
    if (breakIndex < 2) return;

    if (lastBreak.side === "UP") {
      for (let i = breakIndex; i > 0; i--) {
        const c = candles[i];
        if (!c) continue;
        if (c.close < c.open) {
          const ob: OrderBlock = {
            type: "BULLISH",
            top: c.high,
            bottom: c.low,
            timestamp: c.timestamp,
            volume: c.volume,
            isMitigated: false
          };
          this.addOB(ob);
          break;
        }
      }
    } else {
      for (let i = breakIndex; i > 0; i--) {
        const c = candles[i];
        if (!c) continue;
        if (c.close > c.open) {
          const ob: OrderBlock = {
            type: "BEARISH",
            top: c.high,
            bottom: c.low,
            timestamp: c.timestamp,
            volume: c.volume,
            isMitigated: false
          };
          this.addOB(ob);
          break;
        }
      }
    }
  }

  private addOB(ob: OrderBlock) {
    const last = this.obs.at(-1);
    if (last && last.timestamp === ob.timestamp && last.type === ob.type) return;
    this.obs.push(ob);
    if (this.obs.length > 20) this.obs.shift();
  }

  private checkMitigation(candles: readonly DeltaCandle[]) {
    const last = candles.at(-1);
    if (!last) return;

    for (const fvg of this.fvgs) {
      if (fvg.isFilled) continue;
      if (fvg.type === "BULLISH" && last.low <= fvg.bottom) fvg.isFilled = true;
      if (fvg.type === "BEARISH" && last.high >= fvg.top) fvg.isFilled = true;
    }

    for (const ob of this.obs) {
      if (ob.isMitigated) continue;
      if (ob.type === "BULLISH" && last.low <= ob.bottom) ob.isMitigated = true;
      if (ob.type === "BEARISH" && last.high >= ob.top) ob.isMitigated = true;
    }
  }
}
