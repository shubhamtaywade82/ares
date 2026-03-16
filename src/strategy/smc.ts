import { DeltaCandle } from "../delta/types.js";
import { StructureBreak, SwingPoint } from "./structure.js";
import { DisplacementDetector, DisplacementEvent } from "./displacement.detector.js";

export type { DisplacementEvent } from "./displacement.detector.js";

export interface FVG {
  type: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  timestamp: number;
  barIndex: number;
  isFilled: boolean;
}

export interface OrderBlock {
  type: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  timestamp: number;
  barIndex: number;
  volume: number;
  isMitigated: boolean;
}

export interface LiquiditySweep {
  type: "BULL_TRAP" | "BEAR_TRAP";
  reference: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  avgVolume20: number;
  timestamp: number;
  detectedBarIndex: number;
}

export interface BreakerBlock {
  type: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  originalObType: "BULLISH" | "BEARISH";
  timestamp: number;
  barIndex: number;
  isMitigated: boolean;
}

export interface Inducement {
  type: "BULL_INDUCEMENT" | "BEAR_INDUCEMENT";
  level: number;
  timestamp: number;
  barIndex: number;
  isSwept: boolean;
}

export interface NearestZone {
  top: number;
  bottom: number;
  distPct: number;
  isInside: boolean;
}

export interface SmcAnalyzerOptions {
  resolutionMs?: number;
}

const SMC_CONFIG = {
  fallbackResolutionMs: 15 * 60 * 1000,
  maxFvgs: 50,
  maxObs: 20,
  maxSweeps: 10,
  sweepMaxAgeBars: 8,
  nearestZoneMaxAgeBars: 50,
  maxBreakers: 10,
  breakerMaxAgeBars: 30,
  maxInducements: 10,
  inducementMaxAgeBars: 20,
  inducementLookbackBars: 5,
} as const;

/**
 * SMC analyzer for FVG, Order Block and liquidity sweep state derived from closed candles.
 */
export class SmcAnalyzer {
  private fvgs: FVG[] = [];
  private obs: OrderBlock[] = [];
  private sweeps: LiquiditySweep[] = [];
  private breakers: BreakerBlock[] = [];
  private inducements: Inducement[] = [];
  private displacementDetector = new DisplacementDetector();
  private lastProcessedTimestamp = 0;
  private resolutionMs: number;

  constructor(options: SmcAnalyzerOptions = {}) {
    this.resolutionMs = options.resolutionMs ?? SMC_CONFIG.fallbackResolutionMs;
  }

  update(
    candles: readonly DeltaCandle[],
    breaks: StructureBreak[],
    swings: SwingPoint[] = [],
    isLive = true,
    atr?: number
  ) {
    const normalized = candles.map((c) => ({ ...c, timestamp: this.normalizeTimestampMs(c.timestamp) }));
    const last = normalized.at(-1);
    if (!last) return;

    if (isLive && last.timestamp <= this.lastProcessedTimestamp) return;

    this.resolutionMs = this.inferResolutionMs(normalized);
    this.lastProcessedTimestamp = Math.max(this.lastProcessedTimestamp, last.timestamp);

    this.detectFVGs(normalized);
    this.detectOBs(normalized, breaks);
    this.detectLiquiditySweeps(normalized, swings);
    this.checkMitigation(normalized);
    this.detectBreakerBlocks(normalized);
    this.detectInducements(normalized, swings);
    this.expireSweeps();

    // Displacement detection (requires ATR + SMC context)
    if (atr !== undefined && atr > 0) {
      const currentBarIndex = this.barIndex(this.lastProcessedTimestamp);
      this.displacementDetector.detect(normalized, atr, swings, {
        fvgs: this.fvgs.filter((f) => !f.isFilled),
        sweeps: this.sweeps,
        currentBarIndex,
      });
    }
  }

  get lastFVGs(): FVG[] {
    return this.fvgs.filter((f) => !f.isFilled).slice(-5);
  }

  get lastOBs(): OrderBlock[] {
    return this.obs.filter((o) => !o.isMitigated).slice(-5);
  }

  get lastSweeps(): LiquiditySweep[] {
    return this.sweeps.slice(-5);
  }

  get activeSweep(): LiquiditySweep | undefined {
    return this.sweeps.at(-1);
  }

  /** Most recent displacement event, or null if none detected. */
  get lastDisplacement(): DisplacementEvent | null {
    return this.displacementDetector.lastEvent();
  }

  get lastBreakers(): BreakerBlock[] {
    return this.breakers.filter((b) => !b.isMitigated).slice(-5);
  }

  get lastInducements(): Inducement[] {
    return this.inducements.slice(-5);
  }

  get activeInducement(): Inducement | undefined {
    return this.inducements.filter((i) => !i.isSwept).at(-1);
  }

  nearestBreaker(
    price: number,
    type: BreakerBlock["type"],
    maxAgeBars = SMC_CONFIG.nearestZoneMaxAgeBars
  ): NearestZone | null {
    const currentBarIndex = this.barIndex(this.lastProcessedTimestamp);
    const candidates = this.breakers.filter(
      (b) =>
        !b.isMitigated &&
        b.type === type &&
        currentBarIndex - b.barIndex <= Math.max(0, maxAgeBars)
    );
    return this.pickNearestZone(candidates, price);
  }

  activeSweepMetrics(): { ageBars: number; ageMinutes: number; volumeRatio: number } | null {
    const sweep = this.activeSweep;
    if (!sweep || sweep.avgVolume20 <= 0 || this.lastProcessedTimestamp <= 0) return null;

    const currentBarIndex = this.barIndex(this.lastProcessedTimestamp);
    const ageBars = Math.max(0, currentBarIndex - sweep.detectedBarIndex);

    return {
      ageBars,
      ageMinutes: ageBars * this.resolutionMinutes(),
      volumeRatio: sweep.volume / sweep.avgVolume20,
    };
  }

  nearestOB(
    price: number,
    type: OrderBlock["type"],
    maxAgeBars = SMC_CONFIG.nearestZoneMaxAgeBars
  ): NearestZone | null {
    const currentBarIndex = this.barIndex(this.lastProcessedTimestamp);
    const candidates = this.obs.filter(
      (o) =>
        !o.isMitigated &&
        o.type === type &&
        currentBarIndex - o.barIndex <= Math.max(0, maxAgeBars)
    );
    return this.pickNearestZone(candidates, price);
  }

  nearestFVG(
    price: number,
    type: FVG["type"],
    maxAgeBars = SMC_CONFIG.nearestZoneMaxAgeBars
  ): NearestZone | null {
    const currentBarIndex = this.barIndex(this.lastProcessedTimestamp);
    const candidates = this.fvgs.filter(
      (f) =>
        !f.isFilled &&
        f.type === type &&
        currentBarIndex - f.barIndex <= Math.max(0, maxAgeBars)
    );
    return this.pickNearestZone(candidates, price);
  }

  private pickNearestZone(
    zones: Array<{ top: number; bottom: number }>,
    price: number
  ): NearestZone | null {
    if (zones.length === 0 || price <= 0) return null;

    return zones.reduce((acc, zone) => {
      const mid = (zone.top + zone.bottom) / 2;
      const distPct = Math.abs(mid - price) / price;
      const isInside = price <= zone.top && price >= zone.bottom;
      if (!acc || distPct < acc.distPct) {
        return { top: zone.top, bottom: zone.bottom, distPct, isInside };
      }
      return acc;
    }, null as NearestZone | null);
  }

  private detectFVGs(candles: readonly DeltaCandle[]) {
    if (candles.length < 3) return;

    const i = candles.length - 2;
    const p = candles[i - 1];
    const c = candles[i];
    const n = candles[i + 1];

    if (!p || !c || !n) return;

    if (n.low > p.high) {
      this.addFVG({
        type: "BULLISH",
        bottom: p.high,
        top: n.low,
        timestamp: c.timestamp,
        barIndex: this.barIndex(c.timestamp),
        isFilled: false,
      });
    }

    if (n.high < p.low) {
      this.addFVG({
        type: "BEARISH",
        bottom: n.high,
        top: p.low,
        timestamp: c.timestamp,
        barIndex: this.barIndex(c.timestamp),
        isFilled: false,
      });
    }
  }

  private addFVG(fvg: FVG) {
    const last = this.fvgs.at(-1);
    if (last && last.timestamp === fvg.timestamp && last.type === fvg.type) return;
    this.fvgs.push(fvg);
    if (this.fvgs.length > SMC_CONFIG.maxFvgs) this.fvgs.shift();
  }

  private detectOBs(candles: readonly DeltaCandle[], breaks: StructureBreak[]) {
    if (breaks.length === 0) return;
    const lastBreak = breaks.at(-1);
    if (!lastBreak) return;

    const lastCandle = candles.at(-1);
    if (!lastCandle) return;

    const now = lastCandle.timestamp;
    if (now - lastBreak.timestamp > 300000) return;

    const breakIndex = candles.findIndex((c) => c.timestamp === lastBreak.timestamp);
    if (breakIndex < 2) return;

    if (lastBreak.side === "UP") {
      for (let i = breakIndex; i > 0; i--) {
        const c = candles[i];
        if (!c) continue;
        if (c.close < c.open) {
          this.addOB({
            type: "BULLISH",
            top: c.high,
            bottom: c.low,
            timestamp: c.timestamp,
            barIndex: this.barIndex(c.timestamp),
            volume: c.volume,
            isMitigated: false,
          });
          break;
        }
      }
      return;
    }

    for (let i = breakIndex; i > 0; i--) {
      const c = candles[i];
      if (!c) continue;
      if (c.close > c.open) {
        this.addOB({
          type: "BEARISH",
          top: c.high,
          bottom: c.low,
          timestamp: c.timestamp,
          barIndex: this.barIndex(c.timestamp),
          volume: c.volume,
          isMitigated: false,
        });
        break;
      }
    }
  }

  private addOB(ob: OrderBlock) {
    const last = this.obs.at(-1);
    if (last && last.timestamp === ob.timestamp && last.type === ob.type) return;
    this.obs.push(ob);
    if (this.obs.length > SMC_CONFIG.maxObs) this.obs.shift();
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

  private detectBreakerBlocks(candles: readonly DeltaCandle[]) {
    const last = candles.at(-1);
    if (!last) return;

    for (const ob of this.obs) {
      if (!ob.isMitigated) continue;

      let isBroken = false;
      let breakerType: BreakerBlock["type"];

      if (ob.type === "BULLISH" && last.close < ob.bottom) {
        isBroken = true;
        breakerType = "BEARISH";
      } else if (ob.type === "BEARISH" && last.close > ob.top) {
        isBroken = true;
        breakerType = "BULLISH";
      } else {
        continue;
      }

      const exists = this.breakers.some(
        (b) => b.timestamp === ob.timestamp && b.originalObType === ob.type
      );
      if (exists) continue;

      this.breakers.push({
        type: breakerType,
        top: ob.top,
        bottom: ob.bottom,
        originalObType: ob.type,
        timestamp: ob.timestamp,
        barIndex: ob.barIndex,
        isMitigated: false,
      });

      if (this.breakers.length > SMC_CONFIG.maxBreakers) this.breakers.shift();
    }

    const currentBarIndex = this.barIndex(this.lastProcessedTimestamp);
    this.breakers = this.breakers.filter(
      (b) => currentBarIndex - b.barIndex <= SMC_CONFIG.breakerMaxAgeBars
    );

    for (const b of this.breakers) {
      if (b.isMitigated) continue;
      if (b.type === "BULLISH" && last.low <= b.top && last.close >= b.bottom) {
        b.isMitigated = true;
      }
      if (b.type === "BEARISH" && last.high >= b.bottom && last.close <= b.top) {
        b.isMitigated = true;
      }
    }
  }

  private detectInducements(
    candles: readonly DeltaCandle[],
    swings: SwingPoint[]
  ) {
    const last = candles.at(-1);
    if (!last || swings.length < 3) return;

    const currentIndex = candles.length - 1;
    const highs = swings.filter((s) => s.type === "HIGH");
    const lows = swings.filter((s) => s.type === "LOW");

    const lastMajorLow = lows.at(-2);
    const minorLow = lows.at(-1);
    if (
      lastMajorLow &&
      minorLow &&
      minorLow.price > lastMajorLow.price &&
      currentIndex - minorLow.index <= SMC_CONFIG.inducementLookbackBars
    ) {
      const existing = this.inducements.find(
        (ind) =>
          ind.level === minorLow.price && ind.type === "BEAR_INDUCEMENT"
      );
      if (!existing) {
        const isSwept = last.low < minorLow.price;
        this.inducements.push({
          type: "BEAR_INDUCEMENT",
          level: minorLow.price,
          timestamp: minorLow.timestamp,
          barIndex: minorLow.index,
          isSwept,
        });
      } else if (!existing.isSwept && last.low < minorLow.price) {
        existing.isSwept = true;
      }
    }

    const lastMajorHigh = highs.at(-2);
    const minorHigh = highs.at(-1);
    if (
      lastMajorHigh &&
      minorHigh &&
      minorHigh.price < lastMajorHigh.price &&
      currentIndex - minorHigh.index <= SMC_CONFIG.inducementLookbackBars
    ) {
      const existing = this.inducements.find(
        (ind) =>
          ind.level === minorHigh.price && ind.type === "BULL_INDUCEMENT"
      );
      if (!existing) {
        const isSwept = last.high > minorHigh.price;
        this.inducements.push({
          type: "BULL_INDUCEMENT",
          level: minorHigh.price,
          timestamp: minorHigh.timestamp,
          barIndex: minorHigh.index,
          isSwept,
        });
      } else if (!existing.isSwept && last.high > minorHigh.price) {
        existing.isSwept = true;
      }
    }

    this.inducements = this.inducements.filter(
      (ind) =>
        currentIndex - ind.barIndex <= SMC_CONFIG.inducementMaxAgeBars
    );
    if (this.inducements.length > SMC_CONFIG.maxInducements) {
      this.inducements = this.inducements.slice(-SMC_CONFIG.maxInducements);
    }
  }

  private detectLiquiditySweeps(candles: readonly DeltaCandle[], swings: SwingPoint[]) {
    const last = candles.at(-1);
    if (!last || swings.length === 0) return;

    // Snapshot average volume *before* current sweep-candidate candle.
    const avgVolume20 = this.averageVolume(candles.slice(-21, -1));
    if (avgVolume20 <= 0) return;

    const lastHigh = swings
      .filter((s) => s.type === "HIGH" && s.timestamp < last.timestamp)
      .at(-1);
    const lastLow = swings
      .filter((s) => s.type === "LOW" && s.timestamp < last.timestamp)
      .at(-1);

    if (lastHigh && last.high > lastHigh.price && last.close < lastHigh.price) {
      this.addSweep({
        type: "BULL_TRAP",
        reference: lastHigh.price,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: last.volume,
        avgVolume20,
        timestamp: last.timestamp,
        detectedBarIndex: this.barIndex(last.timestamp),
      });
    }

    if (lastLow && last.low < lastLow.price && last.close > lastLow.price) {
      this.addSweep({
        type: "BEAR_TRAP",
        reference: lastLow.price,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: last.volume,
        avgVolume20,
        timestamp: last.timestamp,
        detectedBarIndex: this.barIndex(last.timestamp),
      });
    }
  }

  private averageVolume(candles: readonly DeltaCandle[]): number {
    if (candles.length === 0) return 0;
    const total = candles.reduce((sum, c) => sum + c.volume, 0);
    return total / candles.length;
  }

  private addSweep(sweep: LiquiditySweep) {
    const last = this.sweeps.at(-1);
    if (last && last.type === sweep.type && last.timestamp === sweep.timestamp) return;
    this.sweeps.push(sweep);
    if (this.sweeps.length > SMC_CONFIG.maxSweeps) {
      this.sweeps = this.sweeps.slice(-SMC_CONFIG.maxSweeps);
    }
  }

  private expireSweeps() {
    const currentBarIndex = this.barIndex(this.lastProcessedTimestamp);
    this.sweeps = this.sweeps.filter(
      (s) => currentBarIndex - s.detectedBarIndex <= SMC_CONFIG.sweepMaxAgeBars
    );
  }

  private inferResolutionMs(candles: readonly DeltaCandle[]): number {
    for (let i = candles.length - 1; i > 0; i--) {
      const prev = candles[i - 1];
      const curr = candles[i];
      if (!prev || !curr) continue;
      const delta = curr.timestamp - prev.timestamp;
      if (delta > 0) return delta;
    }
    return this.resolutionMs;
  }

  private normalizeTimestampMs(timestamp: number): number {
    return timestamp > 1e12 ? timestamp : timestamp * 1000;
  }

  private barIndex(timestampMs: number): number {
    if (timestampMs <= 0) return 0;
    return Math.floor(timestampMs / this.resolutionMs);
  }

  private resolutionMinutes(): number {
    return Math.max(1, Math.round(this.resolutionMs / 60_000));
  }
}
