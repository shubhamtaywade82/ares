import { z } from "zod";
import { SystemState, MarketRegime, StructureState, SignalState, PositionState, RiskState } from "./ares.state";
import { SignalType } from "./ares.signal";

/**
 * Zod Schemas for ARES Runtime Validation
 * ES Module Format - Production Grade
 */

export const TargetSchema = z.object({
  level: z.union([z.number(), z.string()]),
  tag: z.string().optional(),
});

export const EntrySchema = z.object({
  model: z.enum(["limit", "market", "stop_market"]),
  zone: z.tuple([z.number(), z.number()]).optional(),
  trigger: z.string().optional(),
});

export const TradeSignalSchema = z.object({
  type: z.nativeEnum(SignalType),
  direction: z.enum(["LONG", "SHORT"]),
  symbol: z.string(),
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
  regime: z.nativeEnum(MarketRegime),
  structure: z.object({
    htfBias: z.enum(["bullish", "bearish"]).optional(),
    bosConfirmed: z.boolean().optional(),
    chochConfirmed: z.boolean().optional(),
    displacement: z.boolean().optional(),
    liquiditySweep: z.boolean().optional(),
  }),
  entry: EntrySchema,
  stop: z.object({
    type: z.enum(["structural", "atr"]).optional(),
    level: z.union([z.number(), z.string()]),
  }),
  targets: z.array(TargetSchema),
  riskReward: z.number(),
  invalidation: z.string(),
  confidence: z.number().min(0).max(1),
  timestamp: z.number(),
});

export const NoTradeSchema = z.object({
  type: z.literal(SignalType.NO_TRADE),
  symbol: z.string(),
  regime: z.nativeEnum(MarketRegime),
  htfBias: z.enum(["bullish", "bearish"]),
  ltfStructure: z.string(),
  tradeAllowed: z.literal(false),
  reason: z.string(),
  timestamp: z.number(),
});

export const ARESSignalValidator = z.discriminatedUnion("type", [
  TradeSignalSchema.extend({ type: z.literal(SignalType.HTF_CONTINUATION) }),
  TradeSignalSchema.extend({ type: z.literal(SignalType.HTF_REVERSAL) }),
  TradeSignalSchema.extend({ type: z.literal(SignalType.LIQUIDITY_SWEEP_REVERSAL) }),
  TradeSignalSchema.extend({ type: z.literal(SignalType.BREAKOUT_EXPANSION) }),
  TradeSignalSchema.extend({ type: z.literal(SignalType.RANGE_ROTATION) }),
  TradeSignalSchema.extend({ type: z.literal(SignalType.MEAN_REVERSION) }),
  TradeSignalSchema.extend({ type: z.literal(SignalType.MOMENTUM_SCALP) }),
  TradeSignalSchema.extend({ type: z.literal(SignalType.FAILED_BREAK) }),
  TradeSignalSchema.extend({ type: z.literal(SignalType.DISTRIBUTION_BREAK) }),
  TradeSignalSchema.extend({ type: z.literal(SignalType.VOLATILITY_COMPRESSION_BREAK) }),
  NoTradeSchema,
]);

/**
 * State Snapshot Validator
 */
export const AresSnapshotSchema = z.object({
  system: z.nativeEnum(SystemState),
  regime: z.nativeEnum(MarketRegime),
  structure: z.nativeEnum(StructureState),
  signal: z.nativeEnum(SignalState),
  position: z.nativeEnum(PositionState),
  risk: z.nativeEnum(RiskState),
  timestamp: z.number(),
});
