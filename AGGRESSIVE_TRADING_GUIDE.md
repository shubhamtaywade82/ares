# ARES Aggressive Trading Configuration Guide

**Adjust parameters to increase trade frequency and position sizes while managing risk.**

---

## ⚠️ Risk Warning

More aggressive = Higher returns BUT also higher losses. Only increase parameters if you:
- ✅ Have sufficient capital cushion (test with 10x-20x larger balance)
- ✅ Understand potential max loss scenarios
- ✅ Can monitor the bot actively
- ✅ Have tested with current settings first

---

## Parameter Adjustment Matrix

### Level 1: Conservative (Default)
```
riskPerTradePct:      0.01 (1%)
maxDailyLossPct:      0.02 (2%)
maxOpenTradesTotal:   4
maxOpenTradesPerSymbol: 1
Signal Score Min:     7.0
Leverage:             5-10x (symbol dependent)
```
**Trade Frequency**: 2-4 trades/day
**Typical Win**: ₹50-200 per trade

### Level 2: Moderate (Recommended First Step)
```
riskPerTradePct:      0.02 (2%)
maxDailyLossPct:      0.05 (5%)
maxOpenTradesTotal:   6
maxOpenTradesPerSymbol: 2
Signal Score Min:     6.5
Leverage:             8-10x
```
**Trade Frequency**: 5-10 trades/day
**Typical Win**: ₹100-500 per trade
**Max Daily Loss**: ₹500 (if equity is ₹10k)

### Level 3: Aggressive
```
riskPerTradePct:      0.03 (3%)
maxDailyLossPct:      0.10 (10%)
maxOpenTradesTotal:   8
maxOpenTradesPerSymbol: 3
Signal Score Min:     6.0
Leverage:             10x (where available)
```
**Trade Frequency**: 10-20 trades/day
**Typical Win**: ₹150-600 per trade
**Max Daily Loss**: ₹1000 (if equity is ₹10k)

### Level 4: Very Aggressive
```
riskPerTradePct:      0.05 (5%)
maxDailyLossPct:      0.15 (15%)
maxOpenTradesTotal:   10+
maxOpenTradesPerSymbol: 4+
Signal Score Min:     5.5
Leverage:             10x (maximum)
```
**Trade Frequency**: 20+ trades/day
**Typical Win**: ₹250-1000+ per trade
**Max Daily Loss**: ₹1500 (if equity is ₹10k)
**⚠️ Risk**: Account can blow up quickly

---

## Parameter-by-Parameter Guide

### 1. Risk Per Trade (`riskPerTradePct`)

**What it does**: Controls position size for each trade

**Current**: `0.01` (1% of equity)
**Options**:
- Conservative: `0.005` (0.5%)
- Moderate: `0.02` (2%)
- Aggressive: `0.03-0.05` (3-5%)

**Impact Example** (Equity = ₹10,000):
```
0.01 → Risk = ₹100  → Position size = ~1 contract
0.02 → Risk = ₹200  → Position size = ~2 contracts
0.05 → Risk = ₹500  → Position size = ~5 contracts
```

**Change**: Edit `src/config/risk.ts` line 2
```typescript
riskPerTradePct: 0.02,  // Change from 0.01
```

**⚠️ Note**: Higher risk = positions sized larger = losses hurt more

---

### 2. Daily Loss Limit (`maxDailyLossPct`)

**What it does**: Kill switch triggers if daily loss exceeds this %

**Current**: `0.02` (2% max daily loss)
**Options**:
- Conservative: `0.01` (1%)
- Moderate: `0.05` (5%)
- Aggressive: `0.10` (10%)

**Impact Example** (Equity = ₹10,000):
```
0.02 → Kill at -₹200 loss (stop trading for the day)
0.05 → Kill at -₹500 loss
0.10 → Kill at -₹1,000 loss
```

**Change**: Edit `src/config/risk.ts` line 3
```typescript
maxDailyLossPct: 0.05,  // Change from 0.02
```

**⚠️ Note**: Higher limit = need more losses before kill switch = risk of larger drawdowns

---

### 3. Max Open Trades (`maxOpenTradesTotal`)

**What it does**: Maximum number of concurrent positions

**Current**: `4` positions total
**Options**:
- Conservative: `2-3`
- Moderate: `6-8`
- Aggressive: `10+`

**Impact Example**:
```
maxOpenTradesTotal=4
  → Can have 4 LONG positions OR mix of LONG/SHORT
  → Max exposure = 4 × (1% risk) = 4% of equity at risk

maxOpenTradesTotal=8
  → Can have up to 8 concurrent positions
  → Max exposure = 8 × (2% risk) = 16% of equity at risk
```

**Change**: Edit `src/config/risk.ts` line 4
```typescript
maxOpenTradesTotal: 8,  // Change from 4
```

**⚠️ Note**: More concurrent trades = more capital tied up = exposure to multiple volatilities

---

### 4. Max Per Symbol (`maxOpenTradesPerSymbol`)

**What it does**: Maximum positions on single symbol (e.g., BTCUSD)

**Current**: `1` position per symbol
**Options**:
- Conservative: `1`
- Moderate: `2-3`
- Aggressive: `3-4`

**Impact Example** (with 2 symbols, 2% risk each):
```
maxOpenTradesPerSymbol=1
  → Max: 1 BTCUSD position + 1 ETHUSD position = 2 total

maxOpenTradesPerSymbol=3
  → Max: 3 BTCUSD positions + 3 ETHUSD positions = 6 total
  → All on same symbol can increase correlation risk
```

**Change**: Edit `src/config/risk.ts` line 5
```typescript
maxOpenTradesPerSymbol: 2,  // Change from 1
```

**⚠️ Note**: Multiple positions on same symbol = highly correlated risk

---

### 5. Signal Score Threshold

**What it does**: Minimum signal quality to trigger entry

**Current**: `7.0` (out of 10)
**Options**:
- Conservative: `7.5+`
- Moderate: `6.5`
- Aggressive: `6.0` or lower

**Impact Example**:
```
Score 7.5+ → Only best setups, fewer trades (2-3/day)
Score 7.0  → Good setups, moderate trades (3-5/day)
Score 6.5  → More setups, higher frequency (5-10/day)
Score 6.0  → Include weaker setups, many trades (10+/day)
```

**Change**: Edit `src/strategy/scorer.ts`
```typescript
if (score < 6.5) return null;  // Change from 7
```

**⚠️ Note**: Lower threshold = more trades BUT lower win rate

---

### 6. Leverage Per Symbol

**What it does**: Maximum leverage allowed per symbol

**Current**:
```
BTCUSD: 10x
ETHUSD: 8x
XRPUSD: 5x
SOLUSD: 5x
```

**Options**:
- Conservative: Reduce by 50% (e.g., BTCUSD: 5x)
- Moderate: Keep as-is
- Aggressive: Max out where allowed (10x for all)

**Impact Example** (BTCUSD with 1% risk):
```
5x leverage  → margin required = $13.60 (smaller positions)
10x leverage → margin required = $6.80 (larger positions)
```

**Change**: Edit `src/config/risk.ts` line 8-13
```typescript
maxLeverageBySymbol: {
  BTCUSD: 10,  // Increase from 10 if lower
  ETHUSD: 10,  // Increase from 8
  XRPUSD: 10,  // Increase from 5
  SOLUSD: 10,  // Increase from 5
}
```

**⚠️ Note**: Higher leverage = smaller required margin = more positions can fit = higher compounded risk

---

### 7. Paper Bypass Score Flag (Cheat Mode)

**What it does**: Ignore signal score in paper mode and enter on weak signals

**Current**: `false` (respect signal quality)
**Options**:
- `false` → Only trade quality signals (recommended)
- `true` → Trade everything (for stress testing)

**Impact**:
```
false → Only trades with score ≥ 7.0
true  → Trades on ANY signal (stress test mode)
```

**Change**: Edit `.env`
```bash
PAPER_BYPASS_SCORE=true  # Only for testing!
```

**⚠️ DANGER**: This will trade bad signals. Only use for simulation testing.

---

## Recommended Aggressive Profiles

### Profile A: Mild Aggression (Start Here)
```typescript
// src/config/risk.ts
riskPerTradePct: 0.02,           // 2% per trade
maxDailyLossPct: 0.05,           // 5% daily max
maxOpenTradesTotal: 6,           // 6 concurrent
maxOpenTradesPerSymbol: 2,       // 2 per symbol
// src/strategy/scorer.ts
if (score < 6.5) return null;    // Lower threshold
```

**Expected Impact**:
- More frequent trades (2x)
- Larger position sizes (2x)
- Higher daily wins possible
- Daily loss buffer doubled

---

### Profile B: Moderate Aggression
```typescript
// src/config/risk.ts
riskPerTradePct: 0.03,           // 3% per trade
maxDailyLossPct: 0.10,           // 10% daily max
maxOpenTradesTotal: 8,           // 8 concurrent
maxOpenTradesPerSymbol: 3,       // 3 per symbol
// src/strategy/scorer.ts
if (score < 6.0) return null;    // Even lower
```

**Expected Impact**:
- 3x more trades
- 3x larger positions
- Higher variance in P&L
- More capital at risk

---

### Profile C: High Aggression (Advanced Only)
```typescript
// src/config/risk.ts
riskPerTradePct: 0.05,           // 5% per trade
maxDailyLossPct: 0.15,           // 15% daily max
maxOpenTradesTotal: 10,          // 10 concurrent
maxOpenTradesPerSymbol: 4,       // 4 per symbol
// src/strategy/scorer.ts
if (score < 5.5) return null;    // Lower threshold
// Also increase leverage to max
maxLeverageBySymbol: {
  BTCUSD: 10,
  ETHUSD: 10,
  XRPUSD: 10,
  SOLUSD: 10,
}
```

**Expected Impact**:
- 5x+ more trades
- 5x larger positions
- High variance (big wins & big losses)
- Risk of rapid drawdowns

**⚠️ WARNING**: This profile can lose significant capital quickly. Only use if:
- You have 20-50x capital cushion
- You can monitor actively
- You accept 20%+ daily loss scenarios

---

## Step-by-Step: From Conservative to Aggressive

### Week 1: Baseline (Current Settings)
```
Configuration: Default (0.01 risk, 2% daily limit)
Goal: Establish win rate with quality signals
Track: Number of trades, win rate, daily P&L
```

### Week 2-3: Test Mild Aggression
```
Changes:
  riskPerTradePct: 0.02 (2x position size)
  maxDailyLossPct: 0.05 (2.5x loss buffer)
  maxOpenTradesTotal: 6 (from 4)

Goal: See if strategy still works with 2x leverage
Track: Is win rate same? Can it handle 6 positions?
```

### Week 4+: Scale to Target Profile
```
If week 2-3 works:
  Increase parameters per chosen profile

If win rate drops below 50%:
  Revert and analyze why
  Adjust signal threshold instead
```

---

## Safety Guardrails

⚠️ **Always keep these in place:**

1. **Kill Switch**: Never disable
   ```typescript
   // This will ALWAYS trigger and close all positions
   KillSwitch.trigger(KillReason.MAX_DAILY_LOSS)
   ```

2. **Position Size Minimum**: Always enforced
   ```typescript
   // Won't create positions smaller than 1 contract
   minLotSize: 1
   ```

3. **Leverage Caps**: Per-symbol limits
   ```typescript
   // Can't exceed these, even if trying
   BTCUSD: 10x maximum
   ```

4. **Margin Check**: Always verified
   ```typescript
   // Won't place order if it violates leverage limit
   Check: Margin ≤ Available Balance × Leverage
   ```

---

## Example: Transitioning to Profile A (Mild Aggression)

### Step 1: Update Risk Config
```bash
# Edit src/config/risk.ts
```

Change line 2:
```typescript
- riskPerTradePct: 0.01,
+ riskPerTradePct: 0.02,
```

Change line 3:
```typescript
- maxDailyLossPct: 0.02,
+ maxDailyLossPct: 0.05,
```

Change line 4:
```typescript
- maxOpenTradesTotal: 4,
+ maxOpenTradesTotal: 6,
```

Change line 5:
```typescript
- maxOpenTradesPerSymbol: 1,
+ maxOpenTradesPerSymbol: 2,
```

### Step 2: Lower Signal Threshold
```bash
# Edit src/strategy/scorer.ts
```

Find line with:
```typescript
if (score < 7) return null;
```

Change to:
```typescript
if (score < 6.5) return null;
```

### Step 3: Rebuild & Test
```bash
npm run build
TRADING_MODE=paper npm run dev
```

### Step 4: Monitor
```bash
# Watch for:
# - Trade frequency (should increase 2x)
# - Win rate (should stay similar)
# - Daily P&L (should increase 2x)
# - Max drawdowns (may be larger)
```

---

## Performance Expectations

### Conservative (0.01 risk, 2% daily limit)
```
Daily Trades: 2-4
Win Rate: 60-70%
Avg Daily P&L: ₹100-300
Max Daily Loss: ₹200
Volatility: Low
```

### Moderate (0.02 risk, 5% daily limit)
```
Daily Trades: 5-10
Win Rate: 50-60%
Avg Daily P&L: ₹300-800
Max Daily Loss: ₹500
Volatility: Medium
```

### Aggressive (0.03+ risk, 10%+ daily limit)
```
Daily Trades: 10-20+
Win Rate: 45-55%
Avg Daily P&L: ₹500-1500
Max Daily Loss: ₹1000+
Volatility: High
```

---

## Common Mistakes to Avoid

❌ **Mistake 1**: Increase risk AND lower signal threshold at same time
- ✅ Do ONE at a time
- Test each change separately

❌ **Mistake 2**: Go straight to aggressive without testing mild aggression
- ✅ Ramp up gradually (week by week)
- Each change should be validated

❌ **Mistake 3**: Ignore win rate when increasing aggression
- ✅ If win rate drops >10%, revert changes
- More trades ≠ better if win rate collapses

❌ **Mistake 4**: Disable kill switch for "more trades"
- ✅ NEVER disable kill switch
- It's your safety net

❌ **Mistake 5**: Use borrowed margin
- ✅ Only trade with owned capital
- Trading on leverage = compounded risk

---

## Quick Decision Tree

```
Start here
    ↓
Do you have 20-30x current balance? (e.g., ₹200k+ for ₹10k strategy)
    ↓
    NO → Stay conservative or use Profile A max
    YES → Can consider Profile B or C
    ↓
Are you comfortable with daily losses of 10%+?
    ↓
    NO → Profile A (2-3% aggression)
    YES → Profile B or C possible
    ↓
Can you monitor bot during trading hours?
    ↓
    NO → Profile A only (automated, safe)
    YES → Profile B (requires attention) or C (requires constant monitoring)
    ↓
What's your win rate in paper trading?
    ↓
    <50% → Stay conservative, fix strategy first
    50-60% → Profiles A-B safe
    >60% → Profiles B-C possible
```

---

## Conclusion

**Start with Profile A** (2x risk, 6 concurrent, 6.5 signal threshold):
- ✅ Doubles potential P&L
- ✅ Still conservative enough to test
- ✅ Easy to revert if issues appear
- ✅ Best risk/reward for learning

Only move to Profile B/C after:
1. ✅ Profile A runs profitably for 1+ week
2. ✅ Win rate stays >50%
3. ✅ You have sufficient capital buffer
4. ✅ You understand the downside

---

**Ready to adjust? Let me know which profile you want to implement!**

