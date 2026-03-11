/**
 * Finance types — models the Delta Exchange India wallet accounting.
 *
 * Wallet currency is INR.  Trading math is USD.  Conversion is fixed @ 85.
 */

/** Side of a derivatives position. */
export type PositionSide = "LONG" | "SHORT";

/** A single open derivatives position tracked by the paper wallet. */
export interface WalletPosition {
  symbol: string;
  productId?: number | undefined;
  side: PositionSide;
  contracts: number;
  entryPrice: number;
  markPrice: number;
  contractValue: number;
}

/** Immutable snapshot of the paper wallet (mirrors the Delta UI). */
export interface WalletSnapshot {
  /** Always "INR" — wallet currency. */
  currency: "INR";

  /** Deposited balance in INR (adjusted by realized PnL). */
  balanceInr: number;

  /** equity = balance + unrealizedPnlInr */
  equityInr: number;

  /** Margin currently locked by open positions. */
  usedMarginInr: number;

  /** equity - usedMargin */
  availableMarginInr: number;

  /** Open-position unrealized PnL in USD. */
  unrealizedPnlUsd: number;

  /** Open-position unrealized PnL in INR. */
  unrealizedPnlInr: number;

  /** Cumulative realized PnL in USD. */
  realizedPnlUsd: number;

  /** Cumulative realized PnL in INR. */
  realizedPnlInr: number;

  /** Snapshot of open positions. */
  positions: readonly WalletPosition[];
}

/** Parameters required to open a new position in the paper wallet. */
export interface OpenPositionParams {
  symbol: string;
  productId?: number | undefined;
  side: PositionSide;
  contracts: number;
  entryPrice: number;
  contractValue: number;
  leverage: number;
}

/** Parameters required to compute position size with INR wallet awareness. */
export interface PositionSizeInput {
  /** Wallet equity in INR. */
  equityInr: number;
  /** Available margin in INR. */
  availableMarginInr: number;
  /** Risk per trade as a fraction (e.g. 0.02 = 2%). */
  riskPct: number;
  /** Entry price in USD. */
  entryPrice: number;
  /** Stop price in USD. */
  stopPrice: number;
  /** Value of one contract in the underlying (e.g. 0.001 BTC). */
  contractValue: number;
  /** Minimum lot size on the exchange. */
  minLotSize: number;
  /** Maximum allowed leverage. */
  maxLeverage: number;
  /** Safety buffer (fraction of max to use, e.g. 0.95). */
  safetyBuffer?: number | undefined;
}

/** Result of position size calculation. */
export interface PositionSizeOutput {
  /** Number of contracts to trade (lot-aligned). */
  contracts: number;
  /** Risk amount in USD. */
  riskUsd: number;
  /** Risk amount in INR. */
  riskInr: number;
  /** Notional exposure in USD. */
  notionalUsd: number;
  /** Notional exposure in INR. */
  notionalInr: number;
  /** Stop distance in USD. */
  stopDistanceUsd: number;
}

/** Dual-currency PnL result. */
export interface PnlResult {
  /** PnL in USD. */
  pnlUsd: number;
  /** PnL in INR. */
  pnlInr: number;
}
