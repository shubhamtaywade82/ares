import { KillReason } from "./kill.reasons.js";

export class KillSwitch {
  private static triggered = false;

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

    process.exit(1);
  }

  static isTriggered(): boolean {
    return this.triggered;
  }
}
