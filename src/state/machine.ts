import {
  SystemState,
  MarketRegime,
  StructureState,
  SignalState,
  PositionState,
  RiskState,
  AresSnapshot
} from "../types/ares.state.js";

/**
 * ARES Finite State Machine
 * Manages 6 independent but composable state domains.
 * Deterministic transition logic for institutional trading.
 */
export class ARESStateMachine {
  private system: SystemState = SystemState.BOOTING;
  private regime: MarketRegime = MarketRegime.UNKNOWN;
  private structure: StructureState = StructureState.NONE;
  private signal: SignalState = SignalState.IDLE;
  private position: PositionState = PositionState.NONE;
  private risk: RiskState = RiskState.NORMAL;

  private lastUpdate: number = Date.now();

  constructor(initialState?: Partial<AresSnapshot>) {
    if (initialState) {
      if (initialState.system) this.system = initialState.system;
      if (initialState.regime) this.regime = initialState.regime;
      if (initialState.structure) this.structure = initialState.structure;
      if (initialState.signal) this.signal = initialState.signal;
      if (initialState.position) this.position = initialState.position;
      if (initialState.risk) this.risk = initialState.risk;
    }
  }

  /**
   * 1. System State Transitions
   */
  public setSystemState(newState: SystemState) {
    if (this.system === SystemState.SHUTDOWN && newState !== SystemState.BOOTING) {
      console.warn("FSM: Cannot transition from SHUTDOWN except to BOOTING");
      return;
    }
    this.system = newState;
    this.lastUpdate = Date.now();
  }

  /**
   * 2. Market Regime Transitions
   */
  public setMarketRegime(newRegime: MarketRegime) {
    this.regime = newRegime;
    this.lastUpdate = Date.now();
  }

  /**
   * 3. Structure State Transitions
   */
  public setStructureState(newStructure: StructureState) {
    this.structure = newStructure;
    this.lastUpdate = Date.now();
  }

  /**
   * 4. Signal Lifecycle Transitions
   * Core execution controller with guard rails.
   */
  public setSignalState(newState: SignalState) {
    const allowed = this.validateSignalTransition(this.signal, newState);
    if (!allowed) {
      console.warn(`FSM: Illegal Signal Transition: ${this.signal} -> ${newState}`);
      return;
    }

    this.signal = newState;
    this.lastUpdate = Date.now();
  }

  /**
   * 5. Position Lifecycle Transitions
   */
  public setPositionState(newState: PositionState) {
    this.position = newState;
    this.lastUpdate = Date.now();
  }

  /**
   * 6. Risk / Safety States
   */
  public setRiskState(newState: RiskState) {
    this.risk = newState;
    this.lastUpdate = Date.now();

    if (newState !== RiskState.NORMAL) {
      this.handleRiskActivation();
    }
  }

  /**
   * Complete Runtime Snapshot
   */
  public getSnapshot(): AresSnapshot {
    return {
      system: this.system,
      regime: this.regime,
      structure: this.structure,
      signal: this.signal,
      position: this.position,
      risk: this.risk,
      timestamp: this.lastUpdate
    };
  }

  /**
   * Signal Transition Validation Logic
   * High-Level State Flow Implementation
   */
  private validateSignalTransition(current: SignalState, next: SignalState): boolean {
    // Global bypasses
    if (next === SignalState.INVALIDATED) return true;
    if (next === SignalState.IDLE) return true;

    switch (current) {
      case SignalState.IDLE:
        return next === SignalState.HTF_BIAS_CONFIRMED;

      case SignalState.HTF_BIAS_CONFIRMED:
        return [SignalState.STRUCTURE_ALIGNED, SignalState.IDLE].includes(next);

      case SignalState.STRUCTURE_ALIGNED:
        return [SignalState.DISPLACEMENT_DETECTED, SignalState.LIQUIDITY_SWEEP_DETECTED, SignalState.IDLE].includes(next);

      case SignalState.DISPLACEMENT_DETECTED:
      case SignalState.LIQUIDITY_SWEEP_DETECTED:
        return [SignalState.PULLBACK_DETECTED, SignalState.IDLE].includes(next);

      case SignalState.PULLBACK_DETECTED:
        return [SignalState.REJECTION_CONFIRMED, SignalState.IDLE].includes(next);

      case SignalState.REJECTION_CONFIRMED:
        return [SignalState.READY_TO_EXECUTE, SignalState.IDLE].includes(next);

      case SignalState.READY_TO_EXECUTE:
        return [SignalState.ORDER_PLACED, SignalState.IDLE].includes(next);

      case SignalState.ORDER_PLACED:
        return [SignalState.ORDER_PARTIALLY_FILLED, SignalState.ORDER_FILLED, SignalState.ORDER_CANCELLED].includes(next);

      case SignalState.ORDER_PARTIALLY_FILLED:
        return [SignalState.ORDER_FILLED, SignalState.ORDER_CANCELLED].includes(next);

      case SignalState.ORDER_FILLED:
        return (next as any) === SignalState.IDLE;

      case SignalState.INVALIDATED:
      case SignalState.ORDER_CANCELLED:
        return (next as any) === SignalState.IDLE;

      default:
        return false;
    }
  }

  private handleRiskActivation() {
    // If we have an active signal that isn't filled yet, invalidate it
    if (![SignalState.ORDER_FILLED, SignalState.IDLE].includes(this.signal)) {
      this.setSignalState(SignalState.INVALIDATED);
    }

    // Auto-pause system on risk trip
    if (this.system === SystemState.RUNNING) {
      this.setSystemState(SystemState.PAUSED);
    }
  }
}
