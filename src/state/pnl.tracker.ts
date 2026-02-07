export class PnlTracker {
  private realized = 0;

  record(pnl: number) {
    this.realized += pnl;
  }

  reset() {
    this.realized = 0;
  }

  get value(): number {
    return this.realized;
  }
}
