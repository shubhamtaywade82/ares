import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
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
