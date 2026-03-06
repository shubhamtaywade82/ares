import { KillReason } from "./kill.reasons.js";

export class KillSwitch {
  private static triggered = false;
  private static cleanupFn: ((reason: KillReason, details?: unknown) => Promise<void> | void) | undefined;

  static setCleanup(fn: (reason: KillReason, details?: unknown) => Promise<void> | void) {
    this.cleanupFn = fn;
  }

  static trigger(reason: KillReason, details?: unknown): never {
    if (this.triggered) {
      process.exit(reason === KillReason.MANUAL ? 0 : 1);
    }

    this.triggered = true;

    if (reason === KillReason.MANUAL) {
      console.log("\n[ARES.KILL] Graceful shutdown initiated (MANUAL)");
    } else {
      console.error("KILL SWITCH TRIGGERED");
      console.error("REASON:", reason);
    }

    if (details !== undefined) {
      console.error("DETAILS:", JSON.stringify(details, null, 2));
    }

    const exitCode = reason === KillReason.MANUAL ? 0 : 1;

    // Use a sync-safe way to trigger cleanup or just let the process exit
    // since we want to be 'never' returning.
    Promise.resolve(this.cleanupFn?.(reason, details))
      .catch((err) => console.error("KILL SWITCH CLEANUP ERROR:", err))
      .finally(() => {
        if (reason === KillReason.MANUAL) {
          console.log("[ARES.KILL] Cleanup complete. Goodbye.");
        }
        process.exit(exitCode);
      });

    // We still need to prevent further execution in the current call stack.
    // If it's manual, we can just sit in an infinite loop or throw a non-error object
    // but throwing is standard for 'never'.
    // However, if we want to avoid the log trace from Node's unhandled exception handler,
    // we can use a temporary trick or just exit(0) immediately if we don't care about async cleanup finishing
    // (but we do care for persistence).

    // To avoid the stack trace, we throw a custom object that we'll catch in main.ts
    // or just throw a string.
    throw `KILL_HALT:${reason}`;
  }

  static isTriggered(): boolean {
    return this.triggered;
  }
}
