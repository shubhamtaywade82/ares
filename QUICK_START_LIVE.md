# 🚀 ARES Live Trading - Quick Start

**Get ARES trading live with real data in 30 minutes.**

---

## Prerequisites (5 minutes)

### 1. Delta Exchange Account
- [ ] Account created and verified
- [ ] Minimum balance: $500 USD
- [ ] API key generated
- [ ] API secret saved securely

### 2. Clone & Install
```bash
cd /path/to/ares
npm install
npm run build
```

### 3. Configure .env

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Delta Exchange API
DELTA_API_KEY=your_api_key_here
DELTA_API_SECRET=your_api_secret_here

# Trading Configuration
TRADING_MODE=live
DELTA_PRODUCT_SYMBOL=BTCUSD

# Conservative Risk Settings (for first test)
RISK_DAILY_LOSS_PCT=0.5         # Max 0.5% daily loss
RISK_POSITION_SIZE_PCT=0.1      # Max 0.1% per position
RISK_MAX_LEVERAGE=5

# Safety Flags
BOOT_BLOCK_ON_ORPHAN_POSITIONS=true
BOOT_CLOSE_ORPHAN_POSITIONS=false

# Logging
LOG_LEVEL=debug
```

---

## Step 1: Verify API Works (5 minutes)

```bash
# Test API connectivity
node << 'EOF'
require('dotenv/config');
const { DeltaRestClient } = require('./dist/delta/rest.client.js');

(async () => {
  const client = new DeltaRestClient();
  try {
    const time = await client.getServerTime();
    console.log('✅ API CONNECTED:', new Date(time).toISOString());

    const balance = await client.getBalances();
    console.log('✅ BALANCE FETCHED:', balance.result[0]);

    const products = await client.getProducts();
    const btc = products.result.find(p => p.symbol === 'BTCUSD');
    console.log('✅ BTC PRODUCT FOUND:', btc.symbol);

    process.exit(0);
  } catch (err) {
    console.error('❌ ERROR:', err.message);
    process.exit(1);
  }
})();
EOF
```

**Expected:**
```
✅ API CONNECTED: 2026-03-03T14:30:45.123Z
✅ BALANCE FETCHED: { available_balance: '1000.00', ... }
✅ BTC PRODUCT FOUND: BTCUSD
```

---

## Step 2: Start Live Trading (10 minutes)

### Option A: Simple Start

```bash
# Start bot in foreground (watch logs directly)
TRADING_MODE=live npm run dev
```

**Watch for:**
```
[ARES.BOOT] Restored paper state...
[ARES.MARKET] WS connected; subscribing to ticker
[ARES.MARKET] WS auth OK; subscribing to orders/positions
[ARES.MARKET] Watchlist LTP BTCUSD=45100.00
```

### Option B: Background Start (Recommended)

```bash
# Start bot in background and monitor
bash scripts/live_test_runner.sh 120  # Run for 120 minutes

# In another terminal, watch logs
tail -f live_tests/live_test_*/bot.log
```

---

## Step 3: Wait for First Trade (5-60 minutes depending on market)

### What to Watch For:

**Entry Signal:**
```
[ARES.STRATEGY] Signal found: LONG score=8.5
[ARES.EXECUTION] Entry order placed: 0.001 BTC @ 45100.00
```

**Entry Fill:**
```
[ARES.WS.RAW] order_update status: closed
[ARES.EXECUTION] Entry filled @ 45102.34
[ARES.MARKET] Position update BTCUSD size=0.001
```

**Verify on Delta Web:**
1. Go to **Orders** → Should see **3 orders**: Entry, SL, TP
2. Go to **Positions** → Should see **BTCUSD LONG 0.001 BTC**

**Position P&L (updates every tick):**
```
[ARES.PAPER] Position BTCUSD LONG qty=0.001 price=45105.00 pnl=24.84 INR
[ARES.PAPER] Position BTCUSD LONG qty=0.001 price=45110.00 pnl=62.10 INR
```

**Exit (TP or SL):**
```
[ARES.EXECUTION] TP Hit @ 46000.00
[ARES.EXECUTION] Exit filled @ 45998.50
[ARES.PAPER] Realized PnL=1660.00 INR ✅
```

---

## Step 4: Validate Trade Data (10 minutes)

### Extract Trade Log

```bash
# Open test directory
cd live_tests/live_test_YYYYMMDD_HHMMSS

# View trade history
cat trades.csv
```

**Expected:**
```
Trade_Number,Entry_Time,Symbol,Side,Entry_Price,Size,Exit_Time,Exit_Price,Exit_Type,PnL_USD,PnL_INR,Duration_Minutes,Status
1,14:30:22,BTCUSD,LONG,45102.34,0.001,14:35:45,45998.50,TP,20.00,1660.00,5.4,VERIFIED
```

### Compare with Delta Exchange

```bash
# Get all orders from Delta API
curl -H "Authorization: Bearer $DELTA_API_KEY" \
  'https://api.delta.exchange/v2/orders?state=closed&limit=10' | jq '.'
```

**Verify:**
- Entry price matches ✓
- Exit price matches ✓
- P&L matches ✓

---

## Step 5: Monitor & Review (Ongoing)

### Real-Time Monitoring

```bash
# Watch live trades as they happen
tail -f live_tests/live_test_*/bot.log | grep -E "Signal|Entry|TP|SL|PnL"
```

### Daily Summary

```bash
# Generate summary report
tail -f live_tests/live_test_*/REPORT.md
```

### Track P&L

```bash
# Extract all trades to CSV
grep -oP 'Realized PnL=\K[0-9.-]+' live_tests/live_test_*/bot.log | \
  awk '{sum+=$1} END {print "Total P&L: ₹" sum}'
```

---

## Emergency Stop

If anything looks wrong:

```bash
# Kill bot immediately
kill -9 $(cat live_tests/live_test_*/bot.pid)

# Close any orphaned positions manually on Delta
# Go to: Positions → Close Position (use market order)
```

---

## Success Checklist After First Trade

- [ ] Entry order placed on Delta Exchange
- [ ] Position opened (visible in Delta Positions)
- [ ] SL order visible in Orders
- [ ] TP order visible in Orders
- [ ] Position P&L showing in real-time
- [ ] Exit filled (TP or SL)
- [ ] Position closed completely
- [ ] P&L matches between bot and Delta
- [ ] Trade logged in CSV
- [ ] No errors in logs

---

## Next Steps

### If First Trade Successful ✅

1. **Continue Trading** - Let bot run for 3-5 more days
2. **Track Win Rate** - Monitor trades accumulate
3. **Scale Carefully** - Increase position size by 2x after 10 successful trades
4. **Add More Symbols** - Try ETHUSD after 5 days with BTCUSD

### If Issues Occur ❌

1. **Check Logs** - Read error messages
2. **Stop Bot** - `kill -9 $(pgrep -f 'npm run dev')`
3. **Review** - Read LIVE_TEST_GUIDE.md troubleshooting section
4. **Debug** - Use test order placement script above
5. **Restart** - Once issue identified and fixed

---

## File Structure Created

```
live_tests/
└── live_test_YYYYMMDD_HHMMSS/
    ├── bot.log              # Complete bot logs
    ├── trades.csv           # All trades (entry/exit prices, P&L)
    ├── monitor.log          # Monitoring snapshots
    ├── errors.log           # Error log only
    ├── REPORT.md            # Summary report
    └── bot.pid              # Process ID (for cleanup)
```

---

## Common Questions

**Q: How long until first trade?**
A: Depends on market conditions, usually 5-60 minutes. If nothing happens after 2 hours, check logs for strategy issues.

**Q: What's the position size?**
A: 0.001 BTC by default (≈ $500 at $45k BTC price). Increase after successful test.

**Q: How often do trades happen?**
A: Typically 2-4 per day on volatile markets. Fewer on quiet markets.

**Q: Is it safe to leave running?**
A: Yes, if you've verified 5+ successful trades. Kill switch will stop all trading if daily loss limit hit.

**Q: Can I watch it live?**
A: Yes, open Delta Exchange web and watch Orders/Positions update in real-time.

**Q: What if bot crashes?**
A: Check for orphaned positions on Delta. Manually close if needed. Read error log to find cause.

**Q: How do I stop it?**
A: Press `Ctrl+C` in terminal, or `kill -9 $(pgrep -f 'npm run dev')`

**Q: Can I scale up after first day?**
A: No. Wait at least 5 days of profitable trading before increasing position size.

---

## 📊 Real-Time Dashboard

Monitor trades as they happen:

```bash
# Terminal 1: Run bot
TRADING_MODE=live npm run dev

# Terminal 2: Watch trades
watch -n 5 'tail -20 live_tests/live_test_*/bot.log | grep -E "Entry|Exit|PnL"'

# Terminal 3: Monitor P&L
watch -n 10 'grep "Realized PnL" live_tests/live_test_*/bot.log | tail -5'

# Terminal 4: Check Delta balance (run every 30s)
watch -n 30 'curl -H "Authorization: Bearer $DELTA_API_KEY" \
  https://api.delta.exchange/v2/account/balance | jq ".result[0].available_balance"'
```

---

## 🔒 Security Checklist

- [ ] `.env` file created locally (NOT committed to Git)
- [ ] API credentials NEVER logged
- [ ] Kill switch tested and working
- [ ] BOOT_BLOCK_ON_ORPHAN_POSITIONS=true
- [ ] First position size very small (0.001 BTC)
- [ ] Daily loss limit conservative (<1%)
- [ ] IP whitelisting configured on Delta (if available)
- [ ] 2FA enabled on Delta account

---

## 📞 Emergency Procedure

If bot behaves unexpectedly:

1. **STOP BOT**
   ```bash
   kill -9 $(pgrep -f 'npm run dev')
   ```

2. **CHECK DELTA POSITIONS**
   ```bash
   curl -H "Authorization: Bearer $DELTA_API_KEY" \
     https://api.delta.exchange/v2/positions
   ```

3. **CLOSE ANY OPEN POSITIONS**
   - Go to Delta → Positions
   - Click "Close Position" on any open trade
   - Use MARKET ORDER to ensure fill

4. **REVIEW ERROR LOG**
   ```bash
   cat live_tests/live_test_*/errors.log
   ```

5. **WAIT 30 MINUTES**
   - Let market settle
   - Review what went wrong

6. **RESTART CAREFULLY**
   - Fix root cause
   - Start with smaller position
   - Monitor closely

---

## ✅ Production Readiness After Live Test

After 5+ days of successful live trading:
- [ ] ≥10 trades completed
- [ ] Win rate ≥50%
- [ ] No orphaned positions
- [ ] All P&L calculations correct
- [ ] No unplanned crashes
- [ ] Ready to scale up

---

**Happy trading! 🚀**

For detailed information, see:
- `LIVE_TEST_GUIDE.md` - Complete testing guide
- `LIVE_TRADING_CHECKLIST.md` - Production checklist
- `TESTING.md` - Full testing suite

---

**Test Start Date:** _______________
**First Trade Completed:** _______________
**Win Rate After 5 Days:** _______________
**Status:** ✅ READY FOR PRODUCTION / ⏳ IN PROGRESS / ❌ NEEDS FIX
