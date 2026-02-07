export interface Position {
  side: "LONG" | "SHORT";
  qty: number;
  entryPrice: number;
}

export class PositionStore {
  private position: Position | undefined;

  open(pos: Position) {
    this.position = pos;
  }

  close() {
    this.position = undefined;
  }

  get current(): Position | undefined {
    return this.position;
  }

  get isOpen(): boolean {
    return this.position !== undefined;
  }
}
