import * as fs from "fs/promises";
import * as path from "path";
import { Position } from "./position.store.js";
import { logger } from "../utils/logger.js";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "paper_state.json");

export interface PaperState {
  realizedPnl: number;
  positions: Position[];
}

export async function savePaperState(state: PaperState): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (error) {
    logger.error(error, "[ARES.STATE] Failed to save paper state");
  }
}

export async function loadPaperState(): Promise<PaperState | null> {
  try {
    const exists = await fs
      .stat(STATE_FILE)
      .then(() => true)
      .catch(() => false);
    if (!exists) return null;

    const data = await fs.readFile(STATE_FILE, "utf-8");
    return JSON.parse(data) as PaperState;
  } catch (error) {
    logger.warn(error, "[ARES.STATE] Failed to load paper state");
    return null;
  }
}
