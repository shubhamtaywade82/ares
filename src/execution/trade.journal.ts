import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { logger } from "../utils/logger.js";
import { TradeRecord } from "./trade.types.js";

export interface TradeAnalytics {
  totalTrades: number;
  winRate: number;
  avgRR: number;
  maxDrawdown: number;
  profitFactor: number;
  netPnL: number;
  bestSetup: string | null;
  worstSetup: string | null;
}

export class TradeJournal {
  public history: TradeRecord[] = [];

  public get stats() {
    const wins = this.history.filter((r) => r.realizedPnl > 0).length;
    const total = this.history.length;
    return {
      winRate: total > 0 ? wins / total : 0,
    };
  }

  /** Full statistical breakdown of all trades. */
  public analyzeTrades(): TradeAnalytics {
    const trades = this.history;
    const total = trades.length;

    if (total === 0) {
      return { totalTrades: 0, winRate: 0, avgRR: 0, maxDrawdown: 0, profitFactor: 0, netPnL: 0, bestSetup: null, worstSetup: null };
    }

    let wins = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    const rMultiples: number[] = [];

    for (const t of trades) {
      if (t.realizedPnl > 0) { wins++; grossProfit += t.realizedPnl; }
      else { grossLoss += Math.abs(t.realizedPnl); }
      rMultiples.push(t.rMultiple);
    }

    // Max drawdown from equity curve
    let peak = 0;
    let equity = 0;
    let maxDD = 0;
    for (const t of trades) {
      equity += t.realizedPnl;
      if (equity > peak) peak = equity;
      const dd = peak !== 0 ? (peak - equity) / Math.abs(peak) : 0;
      if (dd > maxDD) maxDD = dd;
    }

    // Best/worst setup by average R-multiple
    const byReason = new Map<string, { sum: number; count: number }>();
    for (const t of trades) {
      const key = t.signal?.reason ?? t.exitReason;
      const prev = byReason.get(key) ?? { sum: 0, count: 0 };
      byReason.set(key, { sum: prev.sum + t.rMultiple, count: prev.count + 1 });
    }
    let bestSetup: string | null = null;
    let worstSetup: string | null = null;
    let bestAvg = -Infinity;
    let worstAvg = Infinity;
    for (const [key, val] of byReason) {
      const avg = val.sum / val.count;
      if (avg > bestAvg) { bestAvg = avg; bestSetup = key; }
      if (avg < worstAvg) { worstAvg = avg; worstSetup = key; }
    }

    return {
      totalTrades: total,
      winRate: wins / total,
      avgRR: rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length,
      maxDrawdown: maxDD,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      netPnL: grossProfit - grossLoss,
      bestSetup,
      worstSetup,
    };
  }

  constructor(private ndJsonPath = "logs/trades.ndjson") {
    mkdirSync(dirname(this.ndJsonPath), { recursive: true });
    this.loadFromDisk();
  }

  /** Hydrate in-memory history from disk so dashboard shows past trades after restart. */
  private loadFromDisk(): void {
    if (!existsSync(this.ndJsonPath)) return;
    try {
      const raw = readFileSync(this.ndJsonPath, "utf8").trim();
      if (!raw) return;
      const lines = raw.split("\n").filter((line) => line.trim().length > 0);
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as TradeRecord;
          if (record?.id && record?.symbol && typeof record.realizedPnl === "number") {
            this.history.push(record);
          }
        } catch {
          // skip malformed lines
        }
      }
      if (this.history.length > 0) {
        logger.info(
          `[ARES.EXECUTION] Trade journal loaded ${this.history.length} record(s) from ${this.ndJsonPath}`
        );
      }
    } catch (err) {
      logger.warn(err, `[ARES.EXECUTION] Could not load trade journal from ${this.ndJsonPath}`);
    }
  }

  write(record: TradeRecord): void {
    this.history.push(record);
    this.appendDurable(`${JSON.stringify(record)}\n`);
    logger.info(
      `[ARES.EXECUTION] Journal written — ${record.symbol} ${record.exitReason} pnl:${record.realizedPnl.toFixed(2)}`
    );
  }

  private appendDurable(line: string): void {
    const fd = openSync(this.ndJsonPath, "a");
    try {
      writeSync(fd, line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
