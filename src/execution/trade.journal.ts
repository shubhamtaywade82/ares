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

export class TradeJournal {
  public history: TradeRecord[] = [];

  public get stats() {
    const wins = this.history.filter((r) => r.realizedPnl > 0).length;
    const total = this.history.length;
    return {
      winRate: total > 0 ? wins / total : 0,
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
