# ARES Live Trading Test with Real Data

**Real-world validation of ARES with live market data, actual order placement, and complete trade cycle logging.**

---

## Quick Start: Your First Live Test

### Prerequisites Checklist

```bash
# 1. Verify bot builds without errors
npm run build

# 2. Check API credentials work
node -e "
require('dotenv/config');
const { DeltaRestClient } = require('./dist/delta/rest.client.js');
const c = new DeltaRestClient();
c.getServerTime().then(t => console.log('✓ API OK:', new Date(t).toISOString())).catch(e => console.error('✗ API ERROR:', e.message));
"

# 3. Verify live balance
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api.delta.exchange/v2/account/balance
```

### Configuration for First Live Test

Create `.env.live-test`:

```bash
# ============== LIVE TRADING CONFIG ==============
TRADING_MODE=live
NODE_ENV=production
LOG_LEVEL=debug  # Detailed logging for validation

# Delta Exchange
DELTA_API_KEY=your_key
DELTA_API_SECRET=your_secret
DELTA_PRODUCT_SYMBOL=BTCUSD

# Conservative risk limits for first test
RISK_DAILY_LOSS_PCT=0.5      # Only 0.5% max daily loss
RISK_POSITION_SIZE_PCT=0.1   # Only 0.1% per position (~$500 on $500k balance)
RISK_MAX_LEVERAGE=5          # Conservative leverage

# Session constraints (optional - limit trading hours)
TRADING_SESSIONS=ASIA
TRADING_START_HOUR=0
TRADING_END_HOUR=23

# Boot safety
BOOT_BLOCK_ON_ORPHAN_POSITIONS=true
BOOT_CLOSE_ORPHAN_POSITIONS=false

# Logging
LOG_LEVEL=debug
```

---

## Phase 1: Pre-Live Validation (30 minutes)

### Step 1.1: Verify Order Placement Works

```bash
node << 'EOF'
require('dotenv/config');
const { DeltaRestClient } = require('./dist/delta/rest.client.js');

(async () => {
  const client = new DeltaRestClient();

  try {
    console.log('1️⃣ Fetching current BTC price...');
    const products = await client.getProducts({
      contract_types: 'perpetual_futures',
      states: 'live',
    });
    const btc = products.result.find(p => p.symbol === 'BTCUSD');
    console.log('✓ BTC product:', btc.symbol, 'ID:', btc.id);

    // Get current mark price
    const ticker = await client.getPublicTicker(btc.id);
    const currentPrice = Number(ticker.result.mark_price);
    console.log('✓ Current price:', currentPrice);

    console.log('\n2️⃣ Testing POST-ONLY limit order (will NOT fill)...');
    const testOrder = await client.placeOrder({
      product_id: btc.id,
      side: 'buy',
      order_type: 'limit_order',
      limit_price: currentPrice - 1000,  // Well below market
      size: 0.001,  // 0.001 BTC
      post_only: true,
    });

    const orderId = testOrder.result.id;
    console.log('✓ Order placed:', orderId);
    console.log('  Side: BUY');
    console.log('  Size: 0.001 BTC');
    console.log('  Price: ' + (currentPrice - 1000).toFixed(2));
    console.log('  Type: POST-ONLY LIMIT');

    console.log('\n3️⃣ Verifying order in open orders...');
    await new Promise(r => setTimeout(r, 500));
    const orders = await client.getOrders({ state: 'open' });
    const found = orders.result.find(o => o.id === orderId);
    if (found) {
      console.log('✓ Order confirmed in open orders');
      console.log('  Status:', found.state);
      console.log('  Created:', new Date(found.created_at).toISOString());
    }

    console.log('\n4️⃣ Cancelling test order...');
    await client.cancelOrder(orderId);
    console.log('✓ Order cancelled successfully');

    console.log('\n✅ All pre-flight checks passed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
EOF
```

**Expected Output:**
```
1️⃣ Fetching current BTC price...
✓ BTC product: BTCUSD ID: 1
✓ Current price: 45123.45

2️⃣ Testing POST-ONLY limit order (will NOT fill)...
✓ Order placed: 12345678

3️⃣ Verifying order in open orders...
✓ Order confirmed in open orders
  Status: open
  Created: 2026-03-03T...

4️⃣ Cancelling test order...
✓ Order cancelled successfully

✅ All pre-flight checks passed!
```

### Step 1.2: Verify WebSocket Connection

```bash
TRADING_MODE=live npm run dev 2>&1 | head -20 &
BOT_PID=$!

# Wait 10 seconds for connection
sleep 10

# Check logs
ps -p $BOT_PID > /dev/null && echo "✓ Bot running" || echo "✗ Bot crashed"

# Kill test
kill -9 $BOT_PID 2>/dev/null
```

**Expected:**
```
[ARES.BOOT] Restored paper state: PnL=0.00 INR
[ARES.MARKET] WS connected; subscribing to ticker
[ARES.MARKET] WS auth OK; subscribing to orders/positions
```

---

## Phase 2: Live Paper-to-Live Transition (1-2 hours)

### Step 2.1: Enable Live Mode

```bash
# Start bot with live config
export $(cat .env.live-test | grep -v '#' | xargs)
npm run dev 2>&1 | tee live_test_$(date +%Y%m%d_%H%M%S).log
```

**Monitor for these logs (should appear within 30 seconds):**

```
[ARES.BOOT] Loading paper state...
[ARES.MARKET] Using product BTCUSD (id: 1)
[ARES.MARKET] Bootstrapping market data...
[ARES.MARKET] WS connected; subscribing to ticker
[ARES.MARKET] WS auth OK; subscribing to orders/positions
[ARES.MARKET] Watchlist LTP BTCUSD=45123.45
```

### Step 2.2: Verify Market Data Ingestion

**What to watch in logs:**

```
[ARES.MARKET] Watchlist LTP BTCUSD=45100.00  # Updates every 5 seconds
[ARES.MARKET] Watchlist LTP BTCUSD=45105.00
[ARES.MARKET] Watchlist LTP BTCUSD=45102.00
```

**Run this script to validate candles:**

```bash
# In a separate terminal, monitor for candle closes
tail -f live_test_*.log | grep -E "STRATEGY|5m close|Signal"
```

### Step 2.3: Wait for First Signal

**Time to first signal:** Depends on market conditions, usually 5-60 minutes

**What to expect:**

```
[ARES.STRATEGY] 5m close detected, running strategy
[ARES.STRATEGY] Signal found: LONG score=8.5
[ARES.STRATEGY] Reasons: [HTF_BULLISH, SMC_CONFLUENCE, ...]
```

**⚠️ At this point, bot will place REAL orders on live exchange!**

---

## Phase 3: Monitor First Trade Cycle

### Step 3.1: Entry Execution

**Watch logs for:**

```
[ARES.EXECUTION] Live order placed: orderId=123456789
[ARES.EXECUTION] Entry order: LONG 0.001 BTC @ 45100.00 (POST-ONLY LIMIT)
[ARES.EXECUTION] Stop Loss @ 44500.00 (SL reduction)
[ARES.EXECUTION] Take Profit @ 46000.00 (2:1 RR)
```

**Verify on Delta Exchange Web UI:**
1. Go to Orders → Open Orders
2. Should see 3 orders:
   - **Entry (BUY):** 0.001 BTC @ 45100
   - **Stop Loss (SELL):** 0.001 BTC @ 44500 (reduce-only)
   - **Take Profit (SELL):** 0.001 BTC @ 46000 (reduce-only)

**Verify on Delta Web UI:**
```
Entry Price:     45100.00
Size:            0.001 BTC
Status:          Pending
Order Type:      POST-ONLY LIMIT
```

### Step 3.2: Monitor for Fill

**If entry fills (most likely outcome):**

```
[ARES.WS.RAW] order_update status: closed (filled)
[ARES.EXECUTION] Entry fill confirmed: 0.001 BTC @ 45102.34 (avg fill price)
[ARES.MARKET] Position update BTCUSD size=0.001 entry=45102.34
[ARES.PAPER] Position BTCUSD LONG qty=0.001 entry=45102.34 price=45102.34 pnl=0.00 INR
```

**Verify on Delta Web UI:**
- ✓ Position tab shows: BTCUSD LONG 0.001 BTC @ 45102.34
- ✓ Orders tab shows: SL and TP orders still pending
- ✓ Mark-to-Market P&L updates in real-time

### Step 3.3: Monitor Position P&L

**Watch logs every tick:**

```
[ARES.PAPER] Position BTCUSD LONG qty=0.001 entry=45102.34 price=45105.00 pnl=2.48 INR
[ARES.PAPER] Position BTCUSD LONG qty=0.001 entry=45102.34 price=45110.00 pnl=6.64 INR
[ARES.PAPER] Position BTCUSD LONG qty=0.001 entry=45102.34 price=45108.50 pnl=5.24 INR
```

**Cross-check on Delta:**
- Position → BTCUSD → Unrealized P&L (should match bot logs approximately)

### Step 3.4: Exit Execution

**Scenario A: Take Profit Hits**

```
[ARES.EXECUTION] TP Hit @ 46000.00
[ARES.WS.RAW] order_update TP filled
[ARES.EXECUTION] Exit fill confirmed: SELL 0.001 BTC @ 45998.50 (avg fill)
[ARES.MARKET] Position update BTCUSD size=0 (closed)
[ARES.EXECUTION] Realized PnL=1660.00 INR (at 1 USD = 83 INR rate)
[ARES.PAPER] ✓ Realized PnL=1660.00 INR
```

**Scenario B: Stop Loss Hits**

```
[ARES.EXECUTION] SL Hit @ 44500.00
[ARES.WS.RAW] order_update SL filled
[ARES.EXECUTION] Exit fill confirmed: SELL 0.001 BTC @ 44502.50 (avg fill)
[ARES.MARKET] Position update BTCUSD size=0 (closed)
[ARES.EXECUTION] Realized PnL=-498.00 INR (loss)
[ARES.PAPER] ✓ Realized PnL=-498.00 INR
```

**Verify on Delta:**
- ✓ Position closed
- ✓ All 3 orders filled or cancelled
- ✓ Realized P&L matches logs

---

## Phase 4: Validate Trade Data

### Step 4.1: Export Trade Data from Delta

```bash
# Get all closed orders from past 24 hours
curl -H "Authorization: Bearer $DELTA_API_KEY" \
  'https://api.delta.exchange/v2/orders?state=closed&limit=100' > orders_backup.json

# Extract entries and exits
cat orders_backup.json | jq '.result[] | {
  id: .id,
  symbol: .product_symbol,
  side: .side,
  size: .size,
  fill_price: .average_fill_price,
  state: .state,
  created_at: .created_at,
  filled_at: .filled_at
}'
```

### Step 4.2: Compare Bot Logs vs Delta

Create a comparison spreadsheet:

| Bot Log | Delta API | Match | Notes |
|---------|-----------|-------|-------|
| Entry: 0.001 BTC @ 45102.34 | Order filled @ 45102.34 | ✓ | Exact match |
| TP: 0.001 BTC @ 45998.50 | Order filled @ 45998.50 | ✓ | Exact match |
| P&L: 1660 INR | Profit: $20 USD (1660 INR @ 83 rate) | ✓ | Exact match |

### Step 4.3: Verify P&L Calculation

```typescript
// Example: Manual P&L verification
const entryPrice = 45102.34;
const exitPrice = 45998.50;
const contractValue = 0.001;  // BTC per contract
const quantity = 1;           // 1 contract
const leverage = 1;           // No leverage for first test
const INR_PER_USD = 83;

const pnl_usd = (exitPrice - entryPrice) * quantity * contractValue;
const pnl_inr = pnl_usd * INR_PER_USD;

console.log(`P&L USD: $${pnl_usd.toFixed(2)}`);     // $20.00
console.log(`P&L INR: ₹${pnl_inr.toFixed(2)}`);     // ₹1660.00
```

**Log entry in spreadsheet:**
```
Trade #1
Entry:      45102.34 (0.001 BTC)
Exit:       45998.50 (0.001 BTC)
P&L USD:    $20.00
P&L INR:    ₹1660.00
Duration:   45 minutes
Status:     ✓ VERIFIED
```

---

## Phase 5: Extended Live Testing (3-5 Days)

### Day 1: Single Trade Validation

**Objective:** Verify complete lifecycle of ONE trade

**Run:**
```bash
export $(cat .env.live-test | grep -v '#' | xargs)
npm run dev 2>&1 | tee live_test_day1.log
```

**Success Criteria:**
- [ ] One trade cycle completes (entry → exit)
- [ ] Entry order placed on Delta
- [ ] Position opens and shows on Delta
- [ ] Exit (TP or SL) fills
- [ ] Position closes
- [ ] P&L matches between bot and Delta
- [ ] All logs complete and error-free

**Log summary:**
```bash
grep "Entry executed\|TP Hit\|SL Hit\|Realized PnL" live_test_day1.log
```

### Day 2-3: Multiple Cycles

**Objective:** Validate 3+ trade cycles, consistency

**Track:**
```bash
# Count trades
TRADES=$(grep -c "Entry executed" live_test_day2.log)
WINS=$(grep -c "TP Hit" live_test_day2.log)
LOSSES=$(grep -c "SL Hit" live_test_day2.log)
TOTAL_PNL=$(grep "Realized PnL=" live_test_day2.log | awk '{sum+=$NF} END {print sum}')

echo "Day 2 Summary:"
echo "  Total Trades: $TRADES"
echo "  Wins: $WINS"
echo "  Losses: $LOSSES"
echo "  Total P&L: ₹$TOTAL_PNL"
```

**Success Criteria:**
- [ ] ≥2 trades per day
- [ ] Win rate >50%
- [ ] P&L accumulating or stable
- [ ] No orphaned positions
- [ ] No duplicate trades
- [ ] WS connection stable

### Day 4-5: Multi-Symbol (Optional)

**Objective:** Validate with 2+ symbols

```bash
export $(cat .env.live-test | xargs)
DELTA_PRODUCT_SYMBOLS=BTCUSD,ETHUSD npm run dev 2>&1 | tee live_test_day4.log
```

**Success Criteria:**
- [ ] Signals generate independently per symbol
- [ ] No interference between symbols
- [ ] Risk limits enforced globally
- [ ] Multiple concurrent positions handled correctly

---

## Phase 6: Real-Time Monitoring Dashboard

### Create Live Monitoring Script

```bash
#!/bin/bash
# live_monitor.sh - Real-time trade monitoring

LOG_FILE="${1:-live_test_$(date +%Y%m%d_%H%M%S).log}"

watch -n 1 "
echo '═══════════════════════════════════════════════════════'
echo 'ARES LIVE TRADING MONITOR'
echo '═══════════════════════════════════════════════════════'
echo ''
echo '📊 UPTIME:'
UPTIME=\$(tail -1 \"$LOG_FILE\" | awk '{print \$1}')
echo \"  Last log update: \$UPTIME\"
echo ''
echo '📈 TRADES:'
TOTAL_TRADES=\$(grep -c 'Entry executed' \"$LOG_FILE\" 2>/dev/null || echo 0)
WINS=\$(grep -c 'TP Hit' \"$LOG_FILE\" 2>/dev/null || echo 0)
LOSSES=\$(grep -c 'SL Hit' \"$LOG_FILE\" 2>/dev/null || echo 0)
WIN_RATE=\$([ \$TOTAL_TRADES -gt 0 ] && echo \"scale=1; \$WINS * 100 / \$TOTAL_TRADES\" | bc || echo 0)
echo \"  Total: \$TOTAL_TRADES | Wins: \$WINS | Losses: \$LOSSES | Win Rate: \$WIN_RATE%\"
echo ''
echo '💰 P&L:'
TOTAL_PNL=\$(grep -oP 'Realized PnL=\K[0-9.]+' \"$LOG_FILE\" | paste -sd+ | bc 2>/dev/null || echo 0)
echo \"  Total: ₹\$TOTAL_PNL\"
echo ''
echo '⚠️ ERRORS:'
ERRORS=\$(grep -c 'ERROR\|✗' \"$LOG_FILE\" 2>/dev/null || echo 0)
echo \"  Count: \$ERRORS\"
if [ \$ERRORS -gt 0 ]; then
  echo '  Recent:'
  grep 'ERROR\|✗' \"$LOG_FILE\" | tail -2 | sed 's/^/    /'
fi
echo ''
echo '🔄 WEBSOCKET:'
WS_CONNECTS=\$(grep -c 'WS connected' \"$LOG_FILE\" 2>/dev/null || echo 0)
echo \"  Connections: \$WS_CONNECTS (should be ~1)\"
echo ''
echo '═══════════════════════════════════════════════════════'
"
```

**Run:**
```bash
bash live_monitor.sh live_test_day1.log
```

**Output:**
```
═══════════════════════════════════════════════════════
ARES LIVE TRADING MONITOR
═══════════════════════════════════════════════════════

📊 UPTIME:
  Last log update: 14:35:22

📈 TRADES:
  Total: 3 | Wins: 2 | Losses: 1 | Win Rate: 66.7%

💰 P&L:
  Total: ₹2850

⚠️ ERRORS:
  Count: 0

🔄 WEBSOCKET:
  Connections: 1 (should be ~1)

═══════════════════════════════════════════════════════
```

---

## Phase 7: Logging & Audit Trail

### Extract Full Trade Journal

```bash
#!/bin/bash
# Extract all trades from live logs

LOG_FILE="$1"

echo "Trade Journal - $(date)"
echo "============================================="
echo ""

TRADE_NUM=1
grep -E "Entry executed|TP Hit|SL Hit|Realized PnL" "$LOG_FILE" | while IFS= read -r line; do
  if [[ $line == *"Entry executed"* ]]; then
    echo "Trade #$TRADE_NUM"
    echo "$line"
  elif [[ $line == *"TP Hit"* ]] || [[ $line == *"SL Hit"* ]]; then
    echo "$line"
  elif [[ $line == *"Realized PnL"* ]]; then
    echo "$line"
    echo "---"
    ((TRADE_NUM++))
  fi
done
```

**Run:**
```bash
bash extract_trades.sh live_test_day1.log > trade_journal.txt
cat trade_journal.txt
```

**Output:**
```
Trade Journal - 2026-03-03
=============================================

Trade #1
[ARES.EXECUTION] Entry executed: LONG 0.001 BTC @ 45102.34
[ARES.EXECUTION] TP Hit @ 46000.00: +1660.00 INR
[ARES.EXECUTION] Realized PnL=1660.00 INR
---

Trade #2
[ARES.EXECUTION] Entry executed: SHORT 0.001 BTC @ 45500.00
[ARES.EXECUTION] SL Hit @ 45900.00: -330.00 INR
[ARES.EXECUTION] Realized PnL=-330.00 INR
---
```

### Create CSV Export for Analysis

```bash
#!/bin/bash
# Convert logs to CSV for Excel analysis

LOG_FILE="$1"

echo "Entry Time,Symbol,Side,Entry Price,Size,Exit Price,Exit Type,P&L INR,Duration Mins"

grep -E "Entry executed|TP Hit|SL Hit|Realized PnL" "$LOG_FILE" | \
awk '
  /Entry executed/ {
    entry_line = $0
    match(entry_line, /Entry executed: ([^ ]+) ([^ ]+) ([^ ]+) @ ([^ ]+)/, a)
    side = a[1]; qty = a[3]; entry_price = a[4]
    entry_time = match(entry_line, /\[([^\]]+)\]/, t) ? t[1] : ""
  }
  /TP Hit|SL Hit/ {
    exit_line = $0
    match(exit_line, /(TP|SL) Hit @ ([^ ]+)/, b)
    exit_type = b[1]; exit_price = b[2]
  }
  /Realized PnL=/ {
    pnl_line = $0
    match(pnl_line, /Realized PnL=([^ ]+)/, c)
    pnl = c[1]
    print entry_time ",BTCUSD," side "," entry_price "," qty "," exit_price "," exit_type "," pnl ",45"
  }
' > trades.csv

echo "✓ Exported to trades.csv"
```

---

## Phase 8: Daily Checklist During Live Test

### Every Day Before Trading

```bash
# 1. Check server is running
ps aux | grep "node.*main.js" | grep -v grep && echo "✓ Bot running" || echo "✗ Bot not running"

# 2. Check logs for errors
tail -20 live_test_*.log | grep -i error && echo "⚠️ Errors found" || echo "✓ No errors"

# 3. Verify Delta balance hasn't dropped significantly
curl -H "Authorization: Bearer $DELTA_API_KEY" \
  https://api.delta.exchange/v2/account/balance | jq '.result[0].available_balance'

# 4. Check for orphaned positions
curl -H "Authorization: Bearer $DELTA_API_KEY" \
  https://api.delta.exchange/v2/positions | jq '.result[] | select(.size != 0)'

# 5. Check open orders
curl -H "Authorization: Bearer $DELTA_API_KEY" \
  https://api.delta.exchange/v2/orders?state=open | jq '.result | length'
```

### Every Trade

**Immediately after entry:**
```bash
# Verify on Delta
curl -H "Authorization: Bearer $DELTA_API_KEY" \
  https://api.delta.exchange/v2/positions | jq '.result[] | select(.product_symbol == "BTCUSD")'

# Should show:
# {
#   "symbol": "BTCUSD",
#   "size": 0.001,
#   "entry_price": 45102.34,
#   ...
# }
```

**Before exit:**
```bash
# Check P&L calculation
tail -5 live_test_*.log | grep "Position BTCUSD"

# Should show current mark price and unrealized P&L
```

---

## Phase 9: Stop & Analyze

### After 5-Day Test Window

```bash
# Consolidate all logs
cat live_test_day*.log > live_test_consolidated.log

# Generate summary report
bash << 'EOF'
LOG="live_test_consolidated.log"

echo "═══════════════════════════════════════════════════"
echo "ARES 5-DAY LIVE TEST SUMMARY"
echo "═══════════════════════════════════════════════════"
echo ""

TOTAL_TRADES=$(grep -c "Entry executed" "$LOG")
WINS=$(grep -c "TP Hit" "$LOG")
LOSSES=$(grep -c "SL Hit" "$LOG")
WIN_RATE=$(echo "scale=1; $WINS * 100 / $TOTAL_TRADES" | bc 2>/dev/null || echo "0")

echo "📊 TRADE STATISTICS"
echo "  Total Trades:     $TOTAL_TRADES"
echo "  Winning Trades:   $WINS"
echo "  Losing Trades:    $LOSSES"
echo "  Win Rate:         $WIN_RATE%"
echo ""

TOTAL_PNL=$(grep -oP 'Realized PnL=\K[0-9.-]+' "$LOG" | paste -sd+ | bc 2>/dev/null || echo "0")
echo "💰 P&L SUMMARY"
echo "  Total P&L:        ₹$TOTAL_PNL"
echo "  Avg P&L/Trade:    ₹$(echo "scale=2; $TOTAL_PNL / $TOTAL_TRADES" | bc)"
echo ""

ERRORS=$(grep -c "ERROR\|KILL\|Failed" "$LOG" 2>/dev/null || echo "0")
CRASHES=$(grep -c "crashed\|uncaught" "$LOG" 2>/dev/null || echo "0")
echo "⚠️ RELIABILITY"
echo "  Errors:           $ERRORS"
echo "  Crashes:          $CRASHES"
echo "  Uptime:           $([ $CRASHES -eq 0 ] && echo '100%' || echo 'Less than 100%')"
echo ""

echo "✅ STATUS: $([ $CRASHES -eq 0 ] && [ $ERRORS -lt 5 ] && echo 'PASSED' || echo 'REVIEW NEEDED')"
echo "═══════════════════════════════════════════════════"
EOF
```

**Save comprehensive report:**

```bash
cat > live_test_report.md << 'EOF'
# ARES Live Trading Test Report
**Date:** $(date)
**Duration:** 5 days
**Symbol:** BTCUSD
**Mode:** Live Trading

## Summary
- Total Trades: $TOTAL_TRADES
- Win Rate: $WIN_RATE%
- Total P&L: ₹$TOTAL_PNL
- Status: PASSED/FAILED

## Key Findings
- [List any issues]
- [List positive observations]

## Recommendation
Ready for production: YES/NO
EOF
```

---

## Troubleshooting Live Issues

### Issue: Orders Not Filling

```
[ARES.EXECUTION] Entry order placed but no fill after 5 minutes

Diagnosis:
1. Check order is still open: curl https://api.delta.exchange/v2/orders?id=ORDER_ID
2. Check if price moved too far from entry
3. Verify post_only flag isn't preventing fills in fast markets

Solution:
- Lower position size, try again
- Adjust ATR multiplier for SL (make wider)
```

### Issue: Orphaned Position (Position open but no orders)

```
[ARES.MARKET] Position update BTCUSD size=0.001 but no open orders

Diagnosis:
1. Bot crashed after entry, before placing SL/TP
2. WebSocket disconnected

Solution - MANUAL FIX IMMEDIATELY:
curl -X POST https://api.delta.exchange/v2/orders \
  -H "Authorization: Bearer $DELTA_API_KEY" \
  -d '{
    "product_id": 1,
    "side": "sell",
    "order_type": "limit_order",
    "limit_price": 44500,
    "size": 0.001,
    "reduce_only": true
  }'
```

### Issue: Duplicate Positions

```
[ARES.MARKET] Position update shows 0.002 BTC but only 1 entry order

Diagnosis:
1. Partial fill + reconnect caused double entry
2. Bot entered twice

Solution:
1. Close 50% immediately (reduce-only sell 0.001)
2. Review bot logs for reconnection issues
```

---

## Success Criteria for Production Approval

- [ ] 5+ days of live trading completed
- [ ] ≥10 trades executed successfully
- [ ] Win rate ≥50%
- [ ] No orphaned positions
- [ ] No duplicate trades
- [ ] All P&L calculations match Delta
- [ ] Zero crashes or unplanned shutdowns
- [ ] WebSocket reconnection works
- [ ] All logs exportable and complete
- [ ] Manual verification of all trades passed

---

## Next Steps After Successful Test

If all criteria met:
1. ✅ Increase position size by 2-3x
2. ✅ Add second symbol to watchlist
3. ✅ Remove debug logging (set LOG_LEVEL=info)
4. ✅ Deploy to permanent infrastructure (VPS/server)
5. ✅ Set up automated monitoring
6. ✅ Configure backups

---

**Test Date Completed:** _________
**Tester:** _________
**Result:** ✅ PASSED / ❌ FAILED
**Approval:** _________
