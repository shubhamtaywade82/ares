import { mkdirSync, existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface StoredEvent {
  id: string;
  type: string;
  payload: unknown;
  timestamp: number;
}

const LOG_DIR = "logs";
const EVENT_FILE = join(LOG_DIR, "events.ndjson");

// Ensure log directory exists at module load time
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Append a single event to the persistent NDJSON event log.
 * Returns immediately — non-blocking background write.
 */
export const appendEvent = (event: StoredEvent): void => {
  const line = JSON.stringify(event) + "\n";
  // Fire-and-forget; we do NOT await so the hot path is never blocked.
  appendFile(EVENT_FILE, line).catch((err) => {
    console.error("[ARES.EVENT_STORE] Write failed:", err);
  });
};

/**
 * Read all stored events from disk. Used by the replay engine.
 */
export const readEvents = async (): Promise<StoredEvent[]> => {
  if (!existsSync(EVENT_FILE)) return [];
  try {
    const content = await readFile(EVENT_FILE, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as StoredEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is StoredEvent => e !== null);
  } catch (err) {
    console.error("[ARES.EVENT_STORE] Read failed:", err);
    return [];
  }
};
