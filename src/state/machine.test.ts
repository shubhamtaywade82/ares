import { ARESStateMachine } from "./machine";
import { SystemState, SignalState, RiskState, MarketRegime } from "../types/ares.state";
import { SignalType } from "../types/ares.signal";
import { ARESSignalValidator } from "../types/ares.schema";

/**
 * Verification Script for Refined ARES Architecture
 */

function runTests() {
  console.log("🚀 Starting Refined ARES State Machine Verification...\n");

  const sm = new ARESStateMachine();
  const initial = sm.getSnapshot();

  // Test 1: Check initial state
  console.log("Test 1: Initial State check");
  if (initial.system === SystemState.BOOTING && initial.signal === SignalState.IDLE) {
    console.log("✅ Initial state correct.\n");
  } else {
    console.log("❌ Initial state incorrect:", initial);
  }

  // Test 2: Valid Signal Transition (Following high-level flow)
  console.log("Test 2: Valid Signal Transition (IDLE -> HTF_BIAS_CONFIRMED)");
  sm.setSignalState(SignalState.HTF_BIAS_CONFIRMED);
  if (sm.getSnapshot().signal === SignalState.HTF_BIAS_CONFIRMED) {
    console.log("✅ Transition successful.\n");
  } else {
    console.log("❌ Transition failed.\n");
  }

  // Test 3: Illegal Signal Transition
  console.log("Test 3: Illegal Signal Transition (HTF_BIAS_CONFIRMED -> READY_TO_EXECUTE)");
  sm.setSignalState(SignalState.READY_TO_EXECUTE);
  if (sm.getSnapshot().signal === SignalState.HTF_BIAS_CONFIRMED) {
    console.log("✅ Illegal transition blocked correctly.\n");
  } else {
    console.log("❌ Illegal transition allowed!\n");
  }

  // Test 4: New Displacement State
  console.log("Test 4: Displacement Detection State (HTF_BIAS -> STRUCTURE_ALIGNED -> DISPLACEMENT_DETECTED)");
  sm.setSignalState(SignalState.STRUCTURE_ALIGNED);
  sm.setSignalState(SignalState.DISPLACEMENT_DETECTED);
  if (sm.getSnapshot().signal === SignalState.DISPLACEMENT_DETECTED) {
    console.log("✅ Displacement state reached.\n");
  } else {
    console.log("❌ Displacement state failed.\n");
  }

  // Test 5: Risk Activation & Auto-Pause
  console.log("Test 5: Risk Activation (NORMAL -> DAILY_DRAWDOWN_LIMIT_HIT)");
  sm.setSystemState(SystemState.RUNNING);
  sm.setRiskState(RiskState.DAILY_DRAWDOWN_LIMIT_HIT);
  const snapshot = sm.getSnapshot();
  if (snapshot.system === SystemState.PAUSED && snapshot.signal === SignalState.INVALIDATED) {
    console.log("✅ Risk handling activated correctly: System PAUSED, Signal INVALIDATED.\n");
  } else {
    console.log("❌ Risk handling failed:", snapshot);
  }

  // Test 6: Signal Validation (HTF_CONTINUATION)
  console.log("Test 6: Signal Validation (HTF_CONTINUATION)");
  const validSignal = {
    type: SignalType.HTF_CONTINUATION,
    direction: "SHORT",
    symbol: "AUCTIONUSDT",
    timeframe: "15m",
    regime: MarketRegime.TRENDING_BEAR,
    structure: {
      htfBias: "bearish",
      bosConfirmed: true,
      displacement: true
    },
    entry: {
      model: "limit",
      zone: [4.95, 4.99]
    },
    stop: {
      type: "structural",
      level: 5.05
    },
    targets: [
      { level: 4.88, tag: "sell_side_liquidity" },
      { level: 4.75, tag: "4h_demand" }
    ],
    riskReward: 2.3,
    invalidation: "15m close above 5.05",
    confidence: 0.72,
    timestamp: Date.now()
  };

  const result = ARESSignalValidator.safeParse(validSignal);
  if (result.success) {
    console.log("✅ Valid signal parsed successfully.\n");
  } else {
    console.log("❌ Signal validation failed:", result.error.errors);
  }

  // Test 7: No Trade Signal Validation
  console.log("Test 7: No Trade Signal Validation");
  const noTradeSignal = {
    type: SignalType.NO_TRADE,
    symbol: "AUCTIONUSDT",
    regime: MarketRegime.RANGING,
    htfBias: "bearish",
    ltfStructure: "compression",
    tradeAllowed: false,
    reason: "equilibrium rotation without displacement",
    timestamp: Date.now()
  };

  const noTradeResult = ARESSignalValidator.safeParse(noTradeSignal);
  if (noTradeResult.success) {
    console.log("✅ No Trade signal parsed successfully.\n");
  } else {
    console.log("❌ No Trade signal validation failed:", noTradeResult.error.errors);
  }

  console.log("🏁 Verification Complete.");
}

runTests();
