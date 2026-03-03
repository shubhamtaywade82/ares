# ARES Live Trading Test Suite

**Complete guide for testing ARES with real data, live orders, and real P&L.**

---

## 📋 Overview

You now have a **complete testing infrastructure** for production-ready live trading validation:

### Documents Created

| Document | Purpose | Time |
|----------|---------|------|
| **QUICK_START_LIVE.md** | 30-minute quick start guide | 30 min |
| **LIVE_TEST_GUIDE.md** | Detailed testing procedures with real data | 2-5 days |
| **LIVE_TRADING_CHECKLIST.md** | Production readiness checklist | Reference |
| **TESTING.md** | Complete 10-phase testing strategy | Reference |

### Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/test-suite.sh` | Automated 7-phase testing pipeline |
| `scripts/live_test_runner.sh` | Live trading test automation with logging |

---

## 🚀 Start Here: Your First Live Test

### Timeline: 30 minutes to first real trade

**Step 1: Setup (5 min)**
```bash
cd /home/nemesis/project/ai-workspace/ares
npm install && npm run build
```

**Step 2: Configure (5 min)**
```bash
# Create .env with your Delta Exchange credentials
cp .env.example .env

# Edit .env:
# TRADING_MODE=live
# DELTA_API_KEY=your_key
# DELTA_API_SECRET=your_secret
# RISK_DAILY_LOSS_PCT=0.5
# RISK_POSITION_SIZE_PCT=0.1
```

**Step 3: Verify API (5 min)**
```bash
node << 'EOF'
require('dotenv/config');
const { DeltaRestClient } = require('./dist/delta/rest.client.js');
new DeltaRestClient().getServerTime()
  .then(t => console.log('✅ API OK:', new Date(t).toISOString()))
  .catch(e => console.error('❌ Error:', e.message));
EOF
```

**Step 4: Start Trading (5 min)**
```bash
# Option A: Simple (watch logs directly)
TRADING_MODE=live npm run dev

# Option B: Background (use monitoring)
bash scripts/live_test_runner.sh 120  # Run for 120 minutes
```

**Step 5: Monitor (10-60 min)**
- Watch logs for first signal
- Verify entry order on Delta Exchange
- Confirm position opens
- Wait for exit (TP or SL)

---

## 📊 What Happens During a Trade

### Entry
```
Bot detects signal → Places entry order → Order fills → Position opens
         ↓              ↓                    ↓            ↓
  [STRATEGY]   [EXECUTION]              [WS.RAW]    [MARKET]
   Signal        Order placed           Order filled  Position update
   found         BTCUSD LONG             FILLED        BTCUSD size=0.001
```

### Position Management
```
Price updates every second
  ↓
P&L calculated in real-time
  ↓
Logged to console
  ↓
On Delta web: Unrealized P&L updates
```

### Exit
```
Price hits TP or SL → Exit order fills → Position closes → P&L realized
         ↓                ↓                   ↓               ↓
  [EXECUTION]          [WS.RAW]           [MARKET]      [PAPER/EXECUTION]
   TP/SL Hit            Filled            Closed          Realized PnL
   @ 46000              @ 45998            size=0          +1660 INR
```

---

## 🔍 Real-Time Monitoring

### Option 1: Simple Terminal Watch

```bash
# Terminal 1: Run bot
TRADING_MODE=live npm run dev

# Terminal 2: Watch for trades (in another window)
tail -f live_tests/*/bot.log | grep -E "Signal|Entry|Exit|PnL"
```

### Option 2: Advanced Monitoring

```bash
# Terminal 1: Bot
TRADING_MODE=live npm run dev

# Terminal 2: Trades counter
watch -n 5 'echo "TRADE SUMMARY:"; \
  grep -c "Entry executed" live_tests/*/bot.log; \
  echo " wins"; \
  grep -c "TP Hit" live_tests/*/bot.log; \
  echo " losses"; \
  grep -c "SL Hit" live_tests/*/bot.log'

# Terminal 3: P&L tracking
watch -n 10 'grep "Realized PnL" live_tests/*/bot.log | tail -5'

# Terminal 4: Delta balance
watch -n 30 'curl -H "Authorization: Bearer $DELTA_API_KEY" \
  https://api.delta.exchange/v2/account/balance | \
  jq ".result[0].available_balance"'
```

### Option 3: Dashboard View

```bash
# All-in-one view
watch -n 5 "
echo '╔═══════════════════════════════════════╗'
echo '║ ARES Live Trading Monitor              ║'
echo '╠═══════════════════════════════════════╣'
echo '📈 TRADES:'
echo \"  Completed: \$(grep -c 'Entry executed' live_tests/*/bot.log 2>/dev/null || echo 0)\"
echo \"  Wins: \$(grep -c 'TP Hit' live_tests/*/bot.log 2>/dev/null || echo 0)\"
echo \"  Losses: \$(grep -c 'SL Hit' live_tests/*/bot.log 2>/dev/null || echo 0)\"
echo '💰 P&L:'
echo \"  Total: \$(grep -oP 'Realized PnL=\K[0-9.-]+' live_tests/*/bot.log 2>/dev/null | paste -sd+ | bc)\"
echo '⚠️ ERRORS:'
echo \"  Count: \$(grep -c 'ERROR' live_tests/*/bot.log 2>/dev/null || echo 0)\"
echo '╚═══════════════════════════════════════╝'
"
```

---

## 📈 Data Logging & Analysis

### Automatic Trade Log (CSV)

```bash
# View trades as CSV
cat live_tests/live_test_YYYYMMDD_HHMMSS/trades.csv

# Expected output:
# Trade_Number,Entry_Time,Symbol,Side,Entry_Price,Size,Exit_Time,Exit_Price,Exit_Type,PnL_USD,PnL_INR,Duration_Minutes,Status
# 1,14:30:22,BTCUSD,LONG,45102.34,0.001,14:35:45,45998.50,TP,20.00,1660.00,5.4,VERIFIED
# 2,14:42:10,BTCUSD,SHORT,45050.00,0.001,14:48:33,44998.75,SL,-39.88,-3308.54,6.4,VERIFIED
```

### Manual Analysis

```bash
# Extract and analyze trade statistics
bash << 'EOF'
LOG_DIR="live_tests/live_test_"*

TOTAL=$(grep -c "Entry executed" $LOG_DIR/bot.log)
WINS=$(grep -c "TP Hit" $LOG_DIR/bot.log)
LOSSES=$(grep -c "SL Hit" $LOG_DIR/bot.log)
WIN_RATE=$((TOTAL > 0 ? WINS * 100 / TOTAL : 0))
TOTAL_PNL=$(grep -oP 'Realized PnL=\K[0-9.-]+' $LOG_DIR/bot.log | paste -sd+ | bc)

echo "═════════════════════════════════════════"
echo "TRADING SUMMARY"
echo "═════════════════════════════════════════"
echo "Total Trades:    $TOTAL"
echo "Winning Trades:  $WINS"
echo "Losing Trades:   $LOSSES"
echo "Win Rate:        ${WIN_RATE}%"
echo "Total P&L:       ₹$TOTAL_PNL"
echo "═════════════════════════════════════════"
EOF
```

### Cross-Verify with Delta Exchange

```bash
# Export closed orders from Delta
curl -H "Authorization: Bearer $DELTA_API_KEY" \
  'https://api.delta.exchange/v2/orders?state=closed&limit=50' \
  | jq '.result[] | {
    id: .id,
    side: .side,
    size: .size,
    avg_fill_price: .average_fill_price,
    filled_at: .filled_at
  }' > delta_orders.json

# Compare with bot logs
echo "Delta orders:" && cat delta_orders.json | jq length
echo "Bot trades:" && grep -c "Entry executed" live_tests/*/bot.log
```

---

## ✅ Success Validation

### First Trade Checklist

- [ ] Entry signal generated: `[ARES.STRATEGY] Signal found`
- [ ] Order placed on Delta: Visible in Orders tab
- [ ] Order fills: `[ARES.EXECUTION] Entry filled`
- [ ] Position shows: Visible in Positions tab
- [ ] P&L updates: `[ARES.PAPER] Position ... pnl=XXX`
- [ ] Exit triggers: `[ARES.EXECUTION] TP Hit` or `[ARES.EXECUTION] SL Hit`
- [ ] Position closes: `[ARES.MARKET] Position update ... size=0`
- [ ] P&L matches Delta: Manual comparison passes

### Multi-Trade Validation (5 days)

```bash
# Run automated script to validate complete cycle
bash scripts/live_test_runner.sh 120  # 2 hours test

# Check report
cat live_tests/live_test_*/REPORT.md
```

**Expected in Report:**
```markdown
| Metric | Value |
|--------|-------|
| Total Trades | ≥5 |
| Win Rate | ≥50% |
| Total P&L | Positive |
| Errors | 0-2 |
| Crashes | 0 |
```

---

## 🚨 Emergency Scenarios

### Issue: No Trades Generated

```bash
# Check logs for signal generation
grep "Signal found" live_tests/*/bot.log

# If empty: Market conditions may not match strategy criteria
# Solutions:
# 1. Wait longer (market-dependent)
# 2. Check if market is in range-bound (no trending signals)
# 3. Verify indicators updating: grep "5m close" live_tests/*/bot.log
```

### Issue: Order Placed But Not Filling

```bash
# Check Delta web: Orders tab
# Verify:
# - Price is reasonable (within 1% of market)
# - Size is correct (0.001 BTC)
# - Order type is post-only limit

# Solution: Widen stop-loss or adjust entry price
```

### Issue: Orphaned Position (Open but no SL/TP)

```bash
# IMMEDIATELY CLOSE on Delta:
# 1. Go to Positions tab
# 2. Click "Close Position"
# 3. Use MARKET ORDER to ensure fill

# Then analyze logs for what went wrong
grep "ERROR\|KILL\|crashed" live_tests/*/bot.log
```

### Issue: Position Won't Close

```bash
# Manual close via API:
curl -X POST https://api.delta.exchange/v2/orders \
  -H "Authorization: Bearer $DELTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": 1,
    "side": "sell",
    "order_type": "market_order",
    "size": 0.001,
    "reduce_only": true
  }'
```

---

## 📋 Testing Schedule

### Week 1: Single Symbol
```
Day 1: Verify API & first trade cycle
Day 2-3: 3-5 trade cycles, test exits
Day 4-5: Validate P&L accuracy across multiple trades
Day 6-7: Overnight stability test
```

### Week 2: Scale & Monitor
```
Day 8-10: Increase position size 2x, run 10-20 trades
Day 11-14: Add second symbol (ETHUSD), run parallel signals
```

### Week 3+: Production
```
If all criteria met, scale to full positions
Deploy to permanent infrastructure
Set up monitoring and alerts
```

---

## 📊 Expected Performance Metrics

### Single Trade Metrics
| Metric | Expected |
|--------|----------|
| Entry latency | <1 second |
| Fill latency | <2 seconds |
| Exit latency | <1 second |
| P&L accuracy | 100% match with Delta |

### Daily Metrics
| Metric | Expected |
|--------|----------|
| Trades/day | 2-5 |
| Win rate | 50-70% |
| Avg win | $10-30 USD |
| Avg loss | $10-20 USD |
| Max drawdown | <5% of balance |

### System Metrics
| Metric | Expected |
|--------|----------|
| Memory usage | <150 MB |
| CPU usage | <10% |
| Uptime | >99.5% |
| WS reconnects | <1/day |

---

## 🔒 Security During Testing

### API Key Protection
```bash
# NEVER hardcode API keys
# ALWAYS use .env file
# NEVER commit .env to Git

# Verify:
git check-ignore .env  # Should output: .env
```

### Position Size Limits (First 5 Days)
```
Start: 0.001 BTC (~$45)
Day 3: 0.002 BTC (~$90)
Day 7: 0.005 BTC (~$225)
Day 14: 0.01 BTC (~$450)
```

### Kill Switch Testing

```bash
# Verify kill switch works:
# 1. Place small order
# 2. Manually trigger loss scenarios
# 3. Verify all positions close

# Or test in code:
node << 'EOF'
const { KillSwitch } = require('./dist/risk/kill.switch.js');
const { KillReason } = require('./dist/risk/kill.reasons.js');

KillSwitch.trigger(KillReason.MAX_DAILY_LOSS);
// Should log: [ARES.KILL] Emergency flatten start
EOF
```

---

## 📞 Getting Help

### Common Logs to Check

```bash
# Bot errors
grep "ERROR\|KILL\|crashed" live_tests/*/bot.log

# Trade execution
grep "Entry executed\|TP Hit\|SL Hit" live_tests/*/bot.log

# WebSocket health
grep "WS" live_tests/*/bot.log

# API errors
grep "404\|403\|401\|500" live_tests/*/bot.log
```

### Debug Mode

```bash
# Run with verbose logging
LOG_LEVEL=debug TRADING_MODE=live npm run dev 2>&1 | tee debug.log

# Filter specific messages
grep "STRATEGY\|EXECUTION\|RISK" debug.log
```

---

## 🎯 Ready for Production?

After successful live testing, you have:

✅ **Verified Order Placement**
- Real orders placed on Delta Exchange
- Correct sizes, prices, and sides

✅ **Verified Order Execution**
- Orders fill at expected prices
- P&L matches Delta Exchange

✅ **Verified Position Management**
- Entry/SL/TP brackets work correctly
- Positions close properly

✅ **Verified Logging & Audit Trail**
- All trades logged to CSV
- Can replay and verify any trade

✅ **Verified Risk Management**
- Position sizing is correct
- Daily loss limits enforced
- Kill switch triggers properly

✅ **Verified Reliability**
- No orphaned positions
- WebSocket reconnection works
- No crashes in 5+ days

### Next Steps:
1. Deploy to permanent infrastructure
2. Set up monitoring/alerts
3. Document your procedures
4. Scale position sizes gradually
5. Monitor 24/7 for first month

---

## 📚 Reference Documents

**For detailed information:**
- `QUICK_START_LIVE.md` - 30-minute quick start
- `LIVE_TEST_GUIDE.md` - Complete testing procedures
- `LIVE_TRADING_CHECKLIST.md` - Production checklist
- `TESTING.md` - Full 10-phase strategy

**Run automated tests:**
- `scripts/test-suite.sh` - Complete test suite
- `scripts/live_test_runner.sh` - Live trading automation

---

## 📞 Emergency Contacts

During live trading, have these ready:
- Your phone for alerts
- Delta Exchange support
- Cloud provider support (if applicable)
- Server provider support (if remote)

---

**Ready to go live? Start with QUICK_START_LIVE.md! 🚀**

---

*Last updated: 2026-03-03*
*ARES Testing Suite v1.0*
