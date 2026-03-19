/**
 * Symbol-level entry lock — prevents duplicate concurrent entry executions.
 *
 * Usage:
 *   const released = entryLockManager.acquire("BTCUSD");
 *   if (!released) return; // already running
 *   try { await executeEntry(); } finally { released(); }
 */
export class EntryLockManager {
  private locks = new Set<string>();

  /**
   * Try to acquire a lock for `symbol`.
   * Returns a release function if acquired, or null if already locked.
   */
  acquire(symbol: string): (() => void) | null {
    const key = symbol.toUpperCase();
    if (this.locks.has(key)) return null;
    this.locks.add(key);
    return () => this.locks.delete(key);
  }

  /** Check if a symbol is currently locked (read-only). */
  isLocked(symbol: string): boolean {
    return this.locks.has(symbol.toUpperCase());
  }

  /** Release a symbol lock explicitly (idempotent). */
  release(symbol: string): void {
    this.locks.delete(symbol.toUpperCase());
  }
}

export const entryLockManager = new EntryLockManager();
