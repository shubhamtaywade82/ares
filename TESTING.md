# ARES Testing & Validation Guide

**Complete end-to-end testing strategy for full-pledge trading automation on Delta Exchange India.**

---

## Table of Contents
1. [Phase 1: Setup & Prerequisites](#phase-1-setup--prerequisites)
2. [Phase 2: Unit Testing](#phase-2-unit-testing)
3. [Phase 3: Integration Testing](#phase-3-integration-testing)
4. [Phase 4: End-to-End Testing](#phase-4-end-to-end-testing)
5. [Phase 5: Risk Management Testing](#phase-5-risk-management-testing)
6. [Phase 6: WebSocket Resilience](#phase-6-websocket-resilience)
7. [Phase 7: Paper Trading Validation](#phase-7-paper-trading-validation)
8. [Phase 8: Live Trading Dry Run](#phase-8-live-trading-dry-run)
9. [Phase 9: Performance & Load Testing](#phase-9-performance--load-testing)
10. [Phase 10: Production Readiness](#phase-10-production-readiness)
11. [Monitoring & Observability](#monitoring--observability)
12. [Troubleshooting & Recovery](#troubleshooting--recovery)
13. [Sign-Off Checklist](#sign-off-checklist)

---

## Phase 1: Setup & Prerequisites

### 1.1 Environment Configuration

Verify all required environment variables:

```bash
# Core Requirements
DELTA_API_KEY=your_api_key
DELTA_API_SECRET=your_api_secret
DELTA_PRODUCT_SYMBOL=BTCUSD
DELTA_PRODUCT_ID=1  # Set if known, verify against API response
TRADING_MODE=paper  # Start with "paper"

# Risk Configuration
PAPER_BALANCE=100000  # Initial paper balance in INR
RISK_DAILY_LOSS_PCT=2.0  # Max daily loss percentage
RISK_POSITION_SIZE_PCT=1.0  # Max position size as % of equity
RISK_MAX_LEVERAGE=10  # Max leverage for this symbol

# Session Configuration
TRADING_SESSIONS=ASIA,EU,US  # Which sessions to trade
TRADING_START_HOUR=0
TRADING_END_HOUR=23

# AI Configuration (optional)
ANTHROPIC_API_KEY=optional_for_veto_layer
AI_MODEL=claude-3-5-sonnet  # AI model for veto checks

# Feature Flags
PAPER_MARKET_ENTRY=false  # Use limit orders in paper mode
BOOT_BLOCK_ON_ORPHAN_POSITIONS=true  # Block if orphaned positions detected
BOOT_CLOSE_ORPHAN_POSITIONS=false  # Auto-close orphaned positions

# Logging
LOG_LEVEL=debug  # Start with debug, move to info in production
```

### 1.2 Dependency Verification

```bash
npm install
npm run build
npm run build --errors  # Check for TypeScript errors

# Verify key dependencies exist
npm list | grep -E "pino|decimal|technicalindicators"
```

### 1.3 API Connectivity Test

```bash
# Test Delta Exchange API connectivity
node -e "
const { DeltaRestClient } = require('./dist/delta/rest.client.js');
const client = new DeltaRestClient();
client.getServerTime()
  .then(time => console.log('✓ API Connected:', time))
  .catch(err => console.error('✗ API Error:', err.message));
"
```

---

## Phase 2: Unit Testing

### 2.1 Indicator Functions Testing

Test pure functions in isolation:

```bash
# Create test file: __tests__/indicators.test.ts
```

**Test Coverage Checklist:**

- [ ] RSI calculation with edge cases (0%, 50%, 100%)
- [ ] EMA convergence and divergence
- [ ] VWAP price weighting
- [ ] ATR volatility ranges
- [ ] All indicators with empty candle arrays
- [ ] Indicators with single candle
- [ ] Indicators with missing OHLCV data

**Example Test:**

```typescript
import { calculateRSI } from "../src/indicators/rsi.js";

describe("RSI Indicator", () => {
  it("should return 50 for flat market", () => {
    const closes = Array(14).fill(100);
    expect(calculateRSI(closes, 14)).toBe(50);
  });

  it("should handle ascending prices", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const rsi = calculateRSI(closes, 14);
    expect(rsi).toBeGreaterThan(70); // Overbought
  });

  it("should return undefined for insufficient data", () => {
    const closes = [100, 101];
    expect(calculateRSI(closes, 14)).toBeUndefined();
  });
});
```

### 2.2 Risk Calculation Testing

```typescript
describe("Risk Evaluator", () => {
  it("should calculate correct position size", () => {
    const context = {
      equity: 100000,
      availableBalance: 90000,
      dailyPnl: 0,
      openTrades: 0,
    };

    const risk = evaluateRisk(context, {
      symbol: "BTCUSD",
      entryPrice: 45000,
      stopPrice: 44500,
      side: "LONG",
      minLotSize: 1,
      contractValue: 0.001,
      inrToUsd: 1/83,
    });

    expect(risk.qty).toBeGreaterThan(0);
    expect(risk.allowed).toBe(true);
  });

  it("should block if daily loss limit breached", () => {
    const context = {
      equity: 100000,
      availableBalance: 50000,
      dailyPnl: -2500, // 2.5% loss, exceeds 2% limit
      openTrades: 0,
    };

    const risk = evaluateRisk(context, {...});
    expect(risk.allowed).toBe(false);
  });

  it("should block if insufficient balance", () => {
    const context = {
      equity: 10000,
      availableBalance: 500, // Too low
      dailyPnl: 0,
      openTrades: 0,
    };

    const risk = evaluateRisk(context, {...});
    expect(risk.allowed).toBe(false);
  });
});
```

### 2.3 Strategy Signal Testing

```typescript
describe("Strategy Runner", () => {
  it("should detect bullish SMC+AVWAP confluence", async () => {
    const market = new MarketCache();
    // Inject test candles
    const signal = await runStrategy(market, indicators, structure, smc);

    expect(signal).toBeDefined();
    expect(signal.side).toBe("LONG");
    expect(signal.score).toBeGreaterThan(0);
  });

  it("should return null when no signal", async () => {
    const market = new MarketCache();
    // Flat market
    const signal = await runStrategy(market, indicators, structure, smc);
    expect(signal).toBeNull();
  });
});
```

### 2.4 Run Unit Tests

```bash
npm test -- --testPathPattern="__tests__" --coverage

# Expected output:
# ✓ Indicators: 8/8 passed
# ✓ Risk: 12/12 passed
# ✓ Strategy: 6/6 passed
# Coverage: >80%
```

---

## Phase 3: Integration Testing

### 3.1 Market Data Flow Integration

Test the pipeline: `delta/` → `market/` → `indicators/` → `strategy/`

```typescript
describe("Market Data Flow", () => {
  it("should ingest ticks and update candles", async () => {
    const market = new MarketCache();

    // Simulate 5m worth of ticks (300 seconds)
    for (let i = 0; i < 300; i++) {
      market.ingestTick(45000 + Math.sin(i/50) * 100, 1000, Date.now() + i * 1000);
    }

    const candles5m = market.candles("5m");
    expect(candles5m.length).toBeGreaterThan(0);
    expect(candles5m[0]).toHaveProperty("open");
    expect(candles5m[0]).toHaveProperty("close");
  });

  it("should update multiple timeframes consistently", async () => {
    const market = new MarketCache();

    // Inject 1-hour of ticks
    const ticks = generateTestTicks(3600, 45000);
    ticks.forEach(tick => market.ingestTick(tick.price, tick.volume, tick.ts));

    const candles1m = market.candles("1m");
    const candles5m = market.candles("5m");
    const candles15m = market.candles("15m");

    // Check timeframe relationships
    expect(candles5m.length).toBeLessThan(candles1m.length);
    expect(candles15m.length).toBeLessThan(candles5m.length);
  });
});
```

### 3.2 Order Placement Integration

Test order creation → cancellation → bracket management:

```typescript
describe("Order Placement Flow", () => {
  it("should place entry order with SL/TP bracket", async () => {
    const executionSet = await orderManager.execute({
      symbol: "BTCUSD",
      side: "LONG",
      entryPrice: 45000,
      stopPrice: 44500,
      targetPrice: 46000,
      qty: 0.01,
      useMarketEntry: false,
    });

    expect(executionSet.entryOrderId).toBeDefined();
    expect(executionSet.stopLossOrderId).toBeDefined();
    expect(executionSet.takeProfitOrderId).toBeDefined();
  });

  it("should handle partial fill scenarios", async () => {
    // Place order, simulate partial fill
    const orderId = await orderManager.placeEntry(...);
    await orderManager.onLiveEntryPartialFill(orderId, 0.005);

    // Verify brackets rebalanced to partial qty
  });

  it("should cancel stale orders after timeout", async () => {
    const orderId = await orderManager.placeEntry(...);
    // Wait 16 minutes (> 15m timeout)
    await new Promise(r => setTimeout(r, 16 * 60 * 1000));
    await expireStalePendingEntries();

    // Verify order cancelled
  });
});
```

### 3.3 Position Management Integration

```typescript
describe("Position Management", () => {
  it("should track open positions correctly", async () => {
    if (env.TRADING_MODE === "paper" && paper) {
      paper.openPosition(1, "BTCUSD", "LONG", 0.01, 45000);

      const pos = positions.getByProduct(1, "BTCUSD");
      expect(pos).toBeDefined();
      expect(pos.qty).toBe(0.01);
      expect(pos.side).toBe("LONG");
    }
  });

  it("should update stoploss when structure breaks", async () => {
    // Simulate HTF structure change
    const newStop = managePosition(activePos, currentPrice, structure);

    expect(newStop.type).toBe("UPDATE_SL");
    expect(newStop.newStop).toBeLessThan(activePos.stopLoss);
  });

  it("should close position on HTF reversal", async () => {
    const action = managePosition(activePos, currentPrice, structure);
    expect(action.type).toBe("CLOSE");
    expect(action.reason).toContain("HTF");
  });
});
```

### 3.4 Run Integration Tests

```bash
npm test -- --testPathPattern="integration" --runInBand

# Expected output:
# ✓ Market Flow: 4/4 passed
# ✓ Order Flow: 6/6 passed
# ✓ Position Management: 5/5 passed
```

---

## Phase 4: End-to-End Testing

### 4.1 Paper Trading E2E (30-minute cycle)

**Objective:** Validate complete trading flow in paper mode with simulated market data.

```bash
# Start paper mode
TRADING_MODE=paper npm run dev

# Monitor for 30+ minutes watching:
```

**Expected Log Sequence:**

```
[ARES.BOOT] ✓ Paper state restored: PnL=0.00 INR
[ARES.MARKET] ✓ WS connected; subscribing to ticker
[ARES.MARKET] ✓ Watchlist LTP BTCUSD=45000.00
[ARES.STRATEGY] ✓ 5m close detected, running strategy
[ARES.STRATEGY] ✓ Signal found: LONG score=8.5
[ARES.PAPER] ✓ Entry executed: 0.01 BTC @ 45000
[ARES.PAPER] Position BTCUSD LONG qty=0.01 entry=45000.00 price=45100.00 pnl=83.00 INR
[ARES.EXECUTION] ✓ TP Hit @ 46000: +1660.00 INR
[ARES.PAPER] ✓ Realized PnL=1660.00 INR
```

**Validation Checklist:**

- [ ] WS connects and receives ticker data
- [ ] Market data updates every 1-2 seconds
- [ ] 5m candles close and trigger strategy
- [ ] Signal generation works (HTF bias, SMC confluences)
- [ ] Entry orders placed with SL/TP
- [ ] Position tracking accurate
- [ ] P&L calculation correct
- [ ] Exit managers trigger on TP/SL levels
- [ ] Multiple trade cycles complete (≥3 trades)
- [ ] Daily PnL tracking resets at midnight IST
- [ ] No crashes or exceptions in logs
- [ ] Memory usage stable (<150MB)

### 4.2 Single Symbol Validation

Test with one symbol for 1+ hour:

```bash
DELTA_PRODUCT_SYMBOL=BTCUSD TRADING_MODE=paper npm run dev
```

**Metrics to Track:**

| Metric | Target | Method |
|--------|--------|--------|
| Uptime | 100% | Check for crashes |
| Trades/Hour | 2-4 | Count [ARES.EXECUTION] lines |
| Win Rate | >50% | PnL > 0 consistently |
| Max Drawdown | <5% | Watch daily PnL baseline |
| Response Time | <2s | Time from signal to order |
| Data Latency | <500ms | Tick ingestion to candle |

### 4.3 Multi-Symbol Validation

Test with 2-3 symbols:

```bash
DELTA_PRODUCT_SYMBOLS=BTCUSD,ETHUSD TRADING_MODE=paper npm run dev
```

**Expected Behavior:**

- [ ] Independent signal generation per symbol
- [ ] No interference between symbol contexts
- [ ] Risk limits apply per-symbol AND globally
- [ ] Load doesn't exceed 2x single-symbol CPU
- [ ] Memory scales linearly with symbol count

### 4.4 Stress Testing (Rapid Ticks)

Simulate high-frequency data:

```typescript
// Inject 100 ticks/second for 1 minute
const startTs = Date.now();
for (let i = 0; i < 6000; i++) {
  const basePrice = 45000 + Math.sin(i / 100) * 500;
  market.ingestTick(basePrice + Math.random() * 100 - 50, 10000, startTs + i * 10);
}

// Verify:
// - No missed candles
// - Indicators stable
// - No memory leaks
```

---

## Phase 5: Risk Management Testing

### 5.1 Daily Loss Limit

```bash
# Test kill switch trigger at 2% daily loss
RISK_DAILY_LOSS_PCT=2.0 PAPER_BALANCE=100000 npm run dev

# Simulate losses until PnL = -2000 INR (2%)
# Verify: [ARES.KILL] Emergency flatten triggered
```

**Verification:**

```
[ARES.RISK] Daily loss check: dailyPnl=-2050, limit=-2000, breached=true
[ARES.RISK] KILL SWITCH: MAX_DAILY_LOSS triggered
[ARES.KILL] Emergency flatten start: MAX_DAILY_LOSS
[ARES.KILL] cancelAllOrders completed
[ARES.KILL] closeAllPositions completed
```

### 5.2 Position Size Validation

Test that position sizing respects limits:

```typescript
describe("Position Sizing", () => {
  it("should not exceed max position size per symbol", () => {
    const ctxRisk = getRiskContext("BTCUSD");
    const maxQtyAllowed = RISK_CONFIG.maxPositionSizePct * ctxRisk.equity;

    const risk = evaluateRisk(ctxRisk, {...});
    expect(risk.qty * entryPrice * contractValue).toBeLessThanOrEqual(maxQtyAllowed);
  });

  it("should reduce qty if near margin limit", () => {
    const ctxRisk = { availableBalance: 5000, equity: 100000, ... };
    const risk = evaluateRisk(ctxRisk, {
      entryPrice: 45000,
      contractValue: 0.001,
      ...
    });

    const requiredMargin = risk.qty * entryPrice * contractValue / leverage;
    expect(requiredMargin).toBeLessThanOrEqual(ctxRisk.availableBalance * 0.9);
  });
});
```

### 5.3 Leverage & Margin Checks

```bash
# Verify correct leverage resolution
node -e "
const { resolveMaxLeverage } = require('./dist/config/risk.js');
console.log('BTCUSD leverage:', resolveMaxLeverage('BTCUSD'));
console.log('ETHUSD leverage:', resolveMaxLeverage('ETHUSD'));
"
```

Expected output:
```
BTCUSD leverage: 10
ETHUSD leverage: 10
```

### 5.4 Kill Switch Non-Bypassability

```typescript
it("should not allow trades after kill switch", async () => {
  KillSwitch.trigger(KillReason.MAX_DAILY_LOSS);

  // Attempt to place order
  const result = await orderManager.execute({...});
  expect(result).toBeUndefined(); // Blocked
});

it("should cleanup all positions on kill", async () => {
  const cleanup = KillSwitch.cleanup();

  // Verify:
  // - All orders cancelled
  // - All positions closed
  // - WebSocket disconnected
  // - Timers cleared
});
```

---

## Phase 6: WebSocket Resilience

### 6.1 Connection Stability

```bash
# Run for 1+ hour, monitor WS reconnections
TRADING_MODE=paper npm run dev 2>&1 | grep "WS\|connect"

# Expected:
# [ARES.MARKET] WS connected once, then stable
# No repeated reconnections
```

### 6.2 Reconnection Scenario

**Simulate Network Drop:**

```bash
# Kill and restart bot mid-cycle
TRADING_MODE=paper npm run dev &
PID=$!

# Let it run for 30 seconds
sleep 30

# Simulate network disconnect by killing process
kill -9 $PID

# Restart immediately
npm run dev

# Verify:
# - WS reconnects
# - Market data resumes
# - No orphaned orders
# - No duplicate trades
```

**Expected Logs:**

```
[ARES.MARKET] WS connected; subscribing to ticker
[ARES.MARKET] WS disconnected (network error)
[ARES.MARKET] WS reconnecting...
[ARES.MARKET] WS reconnected; reseeding market caches
[ARES.MARKET] WS connected; subscribing to ticker
```

### 6.3 Order/Position WebSocket Recovery

```typescript
describe("WS Recovery", () => {
  it("should reconcile live positions after reconnect", async () => {
    // Place order before disconnect
    const orderId = await orderManager.placeEntry(...);

    // Simulate WS drop and reconnect
    ws.disconnect();
    await new Promise(r => setTimeout(r, 500));
    ws.connect();

    // Verify: Pending entries still tracked
    expect(pendingLiveEntries.has("BTCUSD")).toBe(true);
  });

  it("should handle partial fills across reconnect", async () => {
    // Fill during disconnect
    // Verify on reconnect: fills are captured and processed
  });
});
```

### 6.4 Data Consistency After Reconnect

```bash
# Monitor for 5+ reconnect cycles
TRADING_MODE=paper npm run dev

# Verify in logs:
# - Candle data consistent
# - Indicators recalculated correctly
# - No duplicate signals
# - PnL tracking remains accurate
```

---

## Phase 7: Paper Trading Validation

### 7.1 Multiple Trade Cycles (30+ minutes)

Run in paper mode and validate:

```bash
TRADING_MODE=paper DELTA_PRODUCT_SYMBOLS=BTCUSD,ETHUSD npm run dev
```

**Track these metrics:**

```
Total Trades: ≥3
Winning Trades: ≥50%
Average Win/Loss Ratio: ≥1.5:1
Total PnL: Should be positive if strategy is working
Max Drawdown: <5% of balance
Win Streak: Track longest winning sequence
Loss Streak: Should recover after losses
```

**Sample Output Parsing:**

```bash
# Extract realized PnL entries
grep "Realized PnL" output.log | tail -20

# Count trades
grep "ARES.EXECUTION" output.log | grep -c "Entry executed"

# Track win rate
grep "ARES.EXECUTION" output.log | grep -c "TP Hit"
```

### 7.2 Signal Quality Validation

```bash
# Filter and count signals by score
grep "Signal found" output.log | awk '{print $7}' | sort -n | tail -20

# Expected: High-scoring signals (>7.0) correlate with wins
```

### 7.3 Daily PnL Reset at Midnight IST

Set `TRADING_MODE=paper` and monitor:

```bash
# Watch for midnight IST reset
# Expected at:
# UTC 18:30 (daily baseline reset)

grep "Daily PnL baseline reset" output.log
```

### 7.4 State Persistence

```bash
# Stop and restart bot
npm run dev &
sleep 60
kill -9 $!

npm run dev

# Verify restored state:
# [ARES.BOOT] Restored paper state: PnL=[previous], Positions=[count]
```

---

## Phase 8: Live Trading Dry Run

**⚠️ CRITICAL: Use VERY SMALL position sizes (0.001 BTC) for first live test**

### 8.1 Configuration for Live Test

```bash
TRADING_MODE=live \
DELTA_API_KEY=your_key \
DELTA_API_SECRET=your_secret \
DELTA_PRODUCT_SYMBOL=BTCUSD \
RISK_POSITION_SIZE_PCT=0.1 \
RISK_DAILY_LOSS_PCT=0.5 \
BOOT_BLOCK_ON_ORPHAN_POSITIONS=true \
BOOT_CLOSE_ORPHAN_POSITIONS=false \
npm run dev
```

### 8.2 Pre-Live Checks

- [ ] Account has sufficient balance (minimum $500)
- [ ] API key has order placement permissions
- [ ] Market is open (check Delta Exchange status)
- [ ] No existing positions (clean slate)
- [ ] No pending orders
- [ ] Logs directed to file for audit trail
- [ ] Alerts configured (email/Slack)
- [ ] Kill switch tested and ready

### 8.3 Live Dry Run Execution

```bash
# Monitor first 30 minutes closely
npm run dev 2>&1 | tee live_run.log

# Watch for:
```

**Expected Sequence:**

```
[ARES.BOOT] Reconciled open live position on boot: ...
[ARES.MARKET] WS connected; subscribing to ticker
[ARES.MARKET] WS auth OK; subscribing to orders/positions
[ARES.STRATEGY] Signal found: LONG score=8.2
[ARES.EXECUTION] Live order placed: orderId=12345
[ARES.WS.RAW] order_update status: pending
[ARES.WS.RAW] order_update status: closed (filled)
[ARES.EXECUTION] Entry fill confirmed: 0.001 BTC @ 45123.45
[ARES.MARKET] Position update BTCUSD size=0.001 entry=45123.45
```

### 8.4 Manual Verification

```bash
# Check live balances match bot expectations
delta_api_client.getBalances()

# Verify positions match
delta_api_client.getPositions()
# Should show: {"symbol":"BTCUSD", "size":0.001, ...}

# Verify orders
delta_api_client.getOrders({state:"open"})
# Should show: Entry + SL + TP bracket orders
```

### 8.5 First Trade Exit

- [ ] Monitor until first TP or SL hit
- [ ] Verify bracket order execution
- [ ] Confirm positions fully closed
- [ ] Check P&L on exchange matches logs
- [ ] Verify realized PnL recorded

### 8.6 Monitor & Halt Criteria

**HALT IMMEDIATELY if:**
- [ ] Position unexpectedly large (>2x intended)
- [ ] SL not placed (orphaned entry)
- [ ] TP not placed
- [ ] Multiple fills on single order
- [ ] Rapid reconnection loops
- [ ] Unreconerable state errors
- [ ] Exchange API errors

---

## Phase 9: Performance & Load Testing

### 9.1 Memory Profiling

```bash
# Start with memory monitoring
npm run dev &
PID=$!

# Monitor memory usage
while true; do
  ps aux | grep node | grep -v grep | awk '{print $6}'
  sleep 5
done
```

**Expected Baselines:**

| Metric | Target |
|--------|--------|
| Startup Memory | <50MB |
| Steady State | <100MB |
| After 1000 Ticks | <120MB |
| After 100 Trades | <150MB |
| Peak (under stress) | <200MB |

**Memory Leak Detection:**

```bash
# Run for 4+ hours
# Memory should plateau, not grow linearly
# If growing: Profile with Node inspector
node --inspect src/main.ts
# Open chrome://inspect and check heap snapshots
```

### 9.2 CPU Profiling

```bash
# Monitor CPU usage
npm run dev &
PID=$!

watch -n 1 'ps aux | grep "'$PID'" | grep -v grep | awk "{print \$3}"'
```

**Expected Baselines:**

| Condition | CPU Usage |
|-----------|-----------|
| Idle (no ticks) | <1% |
| Receiving ticks | 2-5% |
| Strategy running | 5-10% |
| Indicator update | 8-15% |
| Peak (multi-symbol) | <20% |

### 9.3 Latency Measurement

```typescript
// Add timing to key operations
const start = performance.now();
const signal = await runStrategy(...);
const duration = performance.now() - start;

logger.info(`[PERF] Strategy execution: ${duration.toFixed(2)}ms`);
```

**Expected Latencies:**

| Operation | Target |
|-----------|--------|
| Tick ingestion | <10ms |
| Candle update | <20ms |
| Indicator calc | <50ms |
| Strategy run | <200ms |
| Signal to order | <1000ms |
| Order to fill (exchange) | <2000ms |

### 9.4 Throughput Testing

```bash
# Simulate 100 ticks/second
# Expected: No dropped ticks, stable processing

for i in {1..1000}; do
  price=$((45000 + RANDOM % 1000))
  # Inject tick
done

# Verify all candles updated
```

### 9.5 Load Test (3+ Symbols)

```bash
DELTA_PRODUCT_SYMBOLS=BTCUSD,ETHUSD,XRPUSD TRADING_MODE=paper npm run dev

# Monitor:
# - CPU usage should remain <15%
# - Memory should not exceed 200MB
# - No missed candles or signals
# - Response time should remain <2s
```

---

## Phase 10: Production Readiness

### 10.1 Configuration Audit

```bash
# Verify critical settings
[ -z "$DELTA_API_KEY" ] && echo "✗ Missing DELTA_API_KEY"
[ -z "$DELTA_API_SECRET" ] && echo "✗ Missing DELTA_API_SECRET"
[ -z "$TRADING_MODE" ] && echo "✗ Missing TRADING_MODE"

# Check risk settings are conservative
[ -z "$RISK_DAILY_LOSS_PCT" ] && echo "✗ Missing RISK_DAILY_LOSS_PCT"
[ $(echo "$RISK_DAILY_LOSS_PCT < 5" | bc) -eq 1 ] && echo "✓ Daily loss limit is reasonable"

echo "✓ All critical configs present"
```

### 10.2 Code Review Checklist

- [ ] No hardcoded API keys in code
- [ ] No `console.log()` in production code (use logger)
- [ ] All error paths handled
- [ ] No infinite loops
- [ ] Kill switch is callable from anywhere
- [ ] All external API calls have timeout
- [ ] No SQL injection vectors (N/A, but check for injection)
- [ ] Credentials never logged
- [ ] CORS restrictions appropriate
- [ ] No unsafe deserialization

### 10.3 Deployment Checklist

- [ ] `.env` file created with production values
- [ ] `.env` never committed to Git
- [ ] `.env.example` has all keys as template
- [ ] Docker image built and tested (optional)
- [ ] PM2 or systemd service configured
- [ ] Graceful shutdown tested (SIGINT, SIGTERM)
- [ ] Log rotation configured
- [ ] Backup database created (if persistent state)
- [ ] Recovery procedure documented
- [ ] Escalation contacts defined

### 10.4 Monitoring Setup

- [ ] Prometheus metrics exported
- [ ] Grafana dashboards created
- [ ] Alerts configured (CPU, memory, errors)
- [ ] PnL tracking dashboard
- [ ] Trade history exportable
- [ ] Audit logs immutable and archived
- [ ] Disk space monitoring
- [ ] Network connectivity checks

### 10.5 Security Audit

- [ ] API key rotation tested
- [ ] Unauthorized access attempts logged
- [ ] Rate limiting in place
- [ ] Request validation on all inputs
- [ ] Output encoding for logs
- [ ] No sensitive data in error messages
- [ ] HTTPS/WSS enforced for all connections
- [ ] IP whitelisting configured (if applicable)
- [ ] Secrets management (not in env directly if possible)

---

## Monitoring & Observability

### Real-Time Monitoring

**Key Metrics Dashboard:**

```bash
# Create custom Pino transport for metrics
npm install pino-http-metrics

# Export to Prometheus
metrics.registerCounter("trades_total");
metrics.registerGauge("position_open");
metrics.registerHistogram("execution_latency_ms");
```

**Grafana Queries:**

```promql
# Win rate
rate(trades_won[5m]) / rate(trades_total[5m])

# Daily PnL
delta_paper_pnl

# Position sizes
delta_position_qty

# Error rate
rate(errors_total[5m])
```

### Log Aggregation

```bash
# Centralize logs (e.g., ELK Stack)
# Or use cloud logging (Datadog, CloudWatch)

# Critical logs to capture:
# - [ARES.KILL] Emergency flatten
# - [ARES.RISK] Breaches
# - [ARES.EXECUTION] Order errors
# - [ARES.STRATEGY] Failures
```

### Alerting Rules

```yaml
# Prometheus alert rules
groups:
  - name: ares_alerts
    rules:
      - alert: ARESKillSwitchTriggered
        expr: ares_kill_switch_triggered
        for: 0m

      - alert: ARESHighErrorRate
        expr: rate(ares_errors[5m]) > 0.1
        for: 2m

      - alert: ARESMemoryLeaking
        expr: rate(ares_memory_bytes[1h]) > 1000000

      - alert: ARESNoDailyProfit
        expr: ares_daily_pnl < 0
        for: 4h
```

---

## Troubleshooting & Recovery

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| No trades generated | No signals | Check strategy logic, market conditions |
| WS keeps disconnecting | Network issue | Verify Delta Exchange status, check firewall |
| Orders rejected | Insufficient balance | Increase PAPER_BALANCE or check live balance |
| Memory growing | Memory leak | Profile with Node inspector, check for unclosed resources |
| Duplicate fills | Reconnect during fill | Improve idempotency in fill handlers |
| PnL incorrect | Trade accounting error | Verify margin/leverage calc, check contract values |

### Recovery Procedures

**Orphaned Position Recovery:**

```bash
# If bot crashes with open position
# Option 1: Manual close via API
delta_client.placeOrder({
  product_symbol: "BTCUSD",
  side: "sell",  # Opposite of position
  order_type: "market_order",
  size: 0.01,
  reduce_only: true
})

# Option 2: Let bot recover on restart
# Set BOOT_CLOSE_ORPHAN_POSITIONS=true
TRADING_MODE=live \
BOOT_CLOSE_ORPHAN_POSITIONS=true \
npm run dev
```

**State Corruption Recovery:**

```bash
# If paper state corrupted, reset:
rm -f ~/.ares/paper_state.json

# Restart with fresh state
TRADING_MODE=paper npm run dev

# Or restore from backup:
cp ~/.ares/paper_state.backup.json ~/.ares/paper_state.json
```

**Clear Stale Orders:**

```bash
# If pending orders stuck
delta_client.cancelAllOrders()

# Then restart bot with clean state
```

---

## Sign-Off Checklist

### Phase 1: Setup ✓
- [ ] Environment variables verified
- [ ] Dependencies installed
- [ ] API connectivity confirmed
- [ ] Build successful (no TypeScript errors)

### Phase 2: Unit Tests ✓
- [ ] All indicator tests pass (≥8)
- [ ] All risk tests pass (≥12)
- [ ] All strategy tests pass (≥6)
- [ ] Code coverage >80%

### Phase 3: Integration Tests ✓
- [ ] Market flow tests pass (≥4)
- [ ] Order flow tests pass (≥6)
- [ ] Position management tests pass (≥5)
- [ ] State persistence verified

### Phase 4: End-to-End ✓
- [ ] 30+ minute paper run completed
- [ ] ≥3 complete trade cycles
- [ ] Win rate >50%
- [ ] No crashes or exceptions
- [ ] Memory stable (<150MB)

### Phase 5: Risk Management ✓
- [ ] Kill switch triggered correctly
- [ ] Daily loss limit enforced
- [ ] Position sizing respected
- [ ] Leverage limits verified

### Phase 6: WebSocket ✓
- [ ] 1+ hour stability test passed
- [ ] Reconnection scenario handled
- [ ] Data consistency verified after reconnect

### Phase 7: Paper Trading ✓
- [ ] Multi-symbol test (2-3 symbols) passed
- [ ] Signal quality validated
- [ ] Daily reset at IST midnight confirmed
- [ ] State persistence tested

### Phase 8: Live Trading ✓
- [ ] Dry run with 0.001 BTC position completed
- [ ] First trade cycle closed successfully
- [ ] Exchange balance matches logs
- [ ] No orphaned positions or orders

### Phase 9: Performance ✓
- [ ] Memory usage within limits
- [ ] CPU usage <20%
- [ ] Latency <2s end-to-end
- [ ] 3+ symbols load tested

### Phase 10: Production Ready ✓
- [ ] All critical configs verified
- [ ] Code review passed
- [ ] Security audit completed
- [ ] Monitoring configured
- [ ] Recovery procedures documented

---

## Sign-Off Template

**Date:** [DATE]
**Tester:** [NAME]
**Environment:** [paper/live]
**Symbols:** [BTCUSD, ...]
**Duration:** [hours]
**Trades:** [count]
**Win Rate:** [%]
**Total PnL:** [amount]

**Status:** ✓ APPROVED FOR PRODUCTION / ✗ REQUIRES FIXES

**Issues Found:**
- [List any issues discovered]

**Approved By:** [SIGNATURE]
**Date Approved:** [DATE]

---

## Quick Start Scripts

```bash
#!/bin/bash

# Test script: test-all.sh
set -e

echo "=== UNIT TESTS ==="
npm test -- --testPathPattern="__tests__" --coverage

echo "=== BUILD CHECK ==="
npm run build

echo "=== LINT CHECK ==="
npm run lint

echo "=== PAPER TRADING 30MIN ==="
timeout 30m npm run dev

echo "=== ALL TESTS PASSED ==="
```

---

## Appendix A: Test Data Generation

Generate realistic test candles:

```typescript
function generateTestCandles(count: number, startPrice: number = 45000) {
  return Array.from({ length: count }, (_, i) => ({
    open: startPrice + Math.sin(i / 20) * 200,
    high: startPrice + Math.sin(i / 20) * 200 + 100,
    low: startPrice + Math.sin(i / 20) * 200 - 100,
    close: startPrice + Math.sin(i / 20) * 200 + Math.random() * 50 - 25,
    volume: 1000 + Math.random() * 5000,
    timestamp: Date.now() - (count - i) * 60000,
  }));
}
```

---

## Appendix B: Key Metrics to Track

| Metric | Formula | Target |
|--------|---------|--------|
| Win Rate | Wins / Total Trades | >50% |
| Profit Factor | Total Wins / Total Losses | >1.5 |
| Sharpe Ratio | (Return - RiskFree) / StdDev | >1.0 |
| Max Drawdown | Peak - Trough / Peak | <5% |
| Recovery Factor | Total Profit / Max Drawdown | >2.0 |
| Risk-Reward | Avg Win / Avg Loss | >1.5 |

---

**Last Updated:** 2026-03-03
**Version:** 1.0
**Maintainer:** ARES Team
