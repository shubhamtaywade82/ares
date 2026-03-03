import { KillReason } from "./kill.reasons.js";

export class KillSwitch {
  private static triggered = false;
  private static cleanupFn: ((reason: KillReason, details?: unknown) => Promise<void> | void) | undefined;

  static setCleanup(fn: (reason: KillReason, details?: unknown) => Promise<void> | void) {
    this.cleanupFn = fn;
  }

  static trigger(reason: KillReason, details?: unknown): never {
    if (this.triggered) {
      process.exit(1);
    }

    this.triggered = true;

    console.error("KILL SWITCH TRIGGERED");
    console.error("REASON:", reason);

    if (details !== undefined) {
      console.error("DETAILS:", JSON.stringify(details, null, 2));
    }

    Promise.resolve(this.cleanupFn?.(reason, details))
      .catch((err) => console.error("KILL SWITCH CLEANUP ERROR:", err))
      .finally(() => process.exit(1));

    throw new Error("Kill switch activated");
  }

  static isTriggered(): boolean {
    return this.triggered;
  }
}
