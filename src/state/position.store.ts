export interface Position {
  side: "LONG" | "SHORT";
  qty: number;
  entryPrice: number;
  productId?: number | undefined;
  productSymbol?: string | undefined;
  stopPrice?: number | undefined;
  targetPrice?: number | undefined;
  cachedProduct?: any;
}

export class PositionStore {
  private static readonly defaultKey = "default";
  private positions = new Map<string, Position>();

  private keyFor(productId?: number, productSymbol?: string): string {
    if (productId != null) return `id:${productId}`;
    if (productSymbol) return `sym:${productSymbol.toUpperCase()}`;
    return PositionStore.defaultKey;
  }

  open(pos: Position) {
    const key = this.keyFor(pos.productId, pos.productSymbol);
    this.positions.set(key, pos);
  }

  close(productId?: number, productSymbol?: string) {
    const key = this.keyFor(productId, productSymbol);
    this.positions.delete(key);
  }

  get current(): Position | undefined {
    return (
      this.positions.get(PositionStore.defaultKey) ??
      this.positions.values().next().value
    );
  }

  get isOpen(): boolean {
    return this.positions.size > 0;
  }

  getByProduct(productId?: number, productSymbol?: string): Position | undefined {
    const key = this.keyFor(productId, productSymbol);
    return this.positions.get(key);
  }

  updateBrackets(
    productId: number | undefined,
    productSymbol: string | undefined,
    stopPrice?: number,
    targetPrice?: number
  ) {
    const key = this.keyFor(productId, productSymbol);
    const pos = this.positions.get(key);
    if (!pos) return;
    pos.stopPrice = stopPrice ?? pos.stopPrice;
    pos.targetPrice = targetPrice ?? pos.targetPrice;
  }

  all(): Position[] {
    return Array.from(this.positions.values());
  }

  closeAll() {
    this.positions.clear();
  }

  hydrate(positions: Position[]) {
    this.positions.clear();
    for (const pos of positions) {
      this.open(pos);
    }
  }
}
