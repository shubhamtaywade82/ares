# ARES Current Configuration State

**Last Updated**: 2026-03-03 (Current)
**Profile**: Profile A+ (Mild Aggression with Enhanced Signal Relaxation)
**Status**: ✅ Active and Ready

---

## Executive Summary

Your ARES bot is currently configured with **Profile A core settings PLUS additional signal relaxation**. This is slightly more aggressive than standard Profile A.

---

## Active Configuration

### Risk Management Settings
**File**: `src/config/risk.ts`

```typescript
export const RISK_CONFIG = {
  riskPerTradePct: 0.02,              // 2% per trade (2x positions)
  maxDailyLossPct: 0.05,              // 5% daily loss limit
  maxOpenTradesTotal: 6,              // Max 6 concurrent positions
  maxOpenTradesPerSymbol: 2,          // Max 2 per symbol
  minRR: 1.5,                         // Risk/Reward ratio minimum
  defaultMaxLeverage: 5,              // Default leverage
  maxLeverageBySymbol: {
    BTCUSD: 10,                       // Bitcoin
    ETHUSD: 8,                        // Ethereum
    XRPUSD: 5,                        // Ripple
    SOLUSD: 5,                        // Solana
  },
  USDINR: 84.0,                       // Currency conversion rate
  GST_RATE: 0.18,                     // Tax rate
};
```

### Strategy Signal Settings
**File**: `src/strategy/scorer.ts`

```typescript
// Signal threshold (line 27)
if (score < 5) return null;           // Accept signals ≥ 5.0 (very relaxed!)
```

**Note**: Changed from original 7.0 → Profile A 6.5 → Current 5.0
This is now between Profile B and Profile C territory!

---

## Configuration Summary Table

| Setting | Value | Original | Profile A | Current | Impact |
|---------|-------|----------|-----------|---------|--------|
| Risk/Trade | 2% | 1% | 2% | 2% | 2x positions |
| Daily Loss | 5% | 2% | 5% | 5% | 2.5x buffer |
| Max Positions | 6 | 4 | 6 | 6 | 1.5x capacity |
| Per Symbol | 2 | 1 | 2 | 2 | 2x per symbol |
| Signal Score | ≥5.0 | ≥7.0 | ≥6.5 | ≥5.0 | 🔴 VERY RELAXED |
| Leverage BTCUSD | 10x | 5x | 5-10x | 10x | Maximum |
| Leverage ETHUSD | 8x | 5x | 5-10x | 8x | High |

---

## What This Means

### Expected Trading Behavior

**Trade Frequency**: 5-20 trades/day
- Very relaxed signal threshold (5.0)
- Takes weaker setups than standard
- Higher volume trading

**Position Sizes**: 2x standard
- Each trade risks ₹200 (vs ₹100 originally)
- Larger individual P&L swings
- Faster capital deployment

**Daily P&L Potential**: ₹300-1000+
- 2x position size × higher trade frequency
- Higher daily wins possible
- Larger daily losses possible

**Risk Level**: Moderate-High
- ⚠️ Signal threshold very relaxed (5.0)
- ⚠️ 2x position sizes
- ⚠️ More exposure at once
- ✅ Kill switch still active at 5% loss

---

## Configuration Changes Timeline

```
Initial State (Conservative):
├─ riskPerTradePct: 0.01
├─ maxDailyLossPct: 0.02
├─ maxOpenTradesTotal: 4
├─ maxOpenTradesPerSymbol: 1
├─ Signal Threshold: 7.0
└─ Status: Very safe, few trades

↓ Applied Profile A (2026-03-03):
├─ riskPerTradePct: 0.02 ✅
├─ maxDailyLossPct: 0.05 ✅
├─ maxOpenTradesTotal: 6 ✅
├─ maxOpenTradesPerSymbol: 2 ✅
├─ Signal Threshold: 6.5 ✅
└─ Status: Mild aggression

↓ User Modified Signal Threshold (2026-03-03):
├─ Signal Threshold: 5.0 ⚠️ (VERY RELAXED)
└─ Status: Between Profile B & C now
```

---

## Critical Safety Settings (Unchanged)

These settings CANNOT be bypassed and protect your account:

```typescript
// Kill Switch (always active)
KillSwitch.trigger(KillReason.MAX_DAILY_LOSS)  // Closes all positions if 5% loss

// Minimum lot size (always enforced)
minLotSize: 1                                   // Won't trade less than 1 contract

// Margin checks (always verified)
Margin Required ≤ (Available Balance × Leverage)  // Every order checked

// Leverage caps (per symbol limit)
BTCUSD: 10x max, ETHUSD: 8x max                   // Hard limits
```

---

## Files Modified

### Modified Files (Current Configuration)
- ✅ `src/config/risk.ts` - Risk parameters (Profile A)
- ✅ `src/strategy/scorer.ts` - Signal threshold (5.0 - VERY RELAXED)

### Unmodified Files (Original)
- ✅ `src/main.ts` - Entry logic
- ✅ `src/execution/paper.executor.ts` - P&L calculations
- ✅ `src/risk/position.sizer.ts` - Position sizing
- ✅ All other core logic

---

## Performance Characteristics

### Expected Daily Performance

**Best Case** (High win rate, many signals):
```
Trades: 15
Wins: 10 (67% win rate)
Losses: 5
Daily P&L: +₹1,000 to +₹1,500
ROI on 10k equity: +10-15% per day
```

**Average Case** (Normal conditions):
```
Trades: 8-10
Wins: 4-5 (50% win rate)
Losses: 4-5
Daily P&L: +₹200 to +₹500
ROI on 10k equity: +2-5% per day
```

**Worst Case** (Bad signals, heavy losses):
```
Trades: 12
Wins: 4 (33% win rate)
Losses: 8
Daily P&L: -₹300 to -₹500
Kill switch may trigger if cumulative loss exceeds ₹500
```

---

## Next Check Checklist

When you next evaluate this configuration, check:

### Trades Generated ✓
- [ ] Number of trades (expect 5-10/day with signal score 5.0)
- [ ] Trade frequency (should be 2-3x original)
- [ ] Win rate (expect 50-60% with relaxed signals)

### P&L Performance ✓
- [ ] Daily P&L (expect 2-3x original)
- [ ] Average win size (should be ~₹200-300)
- [ ] Average loss size (should be ~₹150-250)
- [ ] Daily loss limit hit? (should be rare unless losing streak)

### Position Sizing ✓
- [ ] Average position size (should be ~2 contracts)
- [ ] Max concurrent positions (should be 3-6)
- [ ] Any margin violations? (should be none)

### Signal Quality ✓
- [ ] Are signals at score 5.0 profitable? (key question!)
- [ ] Win rate at score 5.0 vs 6.5 vs 7.0 (analyze by threshold)
- [ ] Consider reverting to 6.5 if win rate drops <45%

### Risk Events ✓
- [ ] Kill switch triggered? (when/why?)
- [ ] Position limit hit? (6 concurrent?)
- [ ] Leverage warnings? (none should occur)
- [ ] Margin check failures? (none should occur)

---

## Revert Instructions (If Needed)

### To Revert to Profile A Standard (6.5 threshold)
```bash
# Edit src/strategy/scorer.ts line 27
if (score < 6.5) return null;  # Change from 5
```

### To Revert to Original (7.0 threshold)
```bash
# Edit src/strategy/scorer.ts line 27
if (score < 7) return null;  # Change from 5
```

### To Revert All to Conservative Original
```bash
# Edit src/config/risk.ts
riskPerTradePct: 0.01,              # Change from 0.02
maxDailyLossPct: 0.02,              # Change from 0.05
maxOpenTradesTotal: 4,              # Change from 6
maxOpenTradesPerSymbol: 1,          # Change from 2

# Edit src/strategy/scorer.ts
if (score < 7) return null;         # Change from 5
```

---

## Build Status

**Last Build**: 2026-03-03
**Status**: ✅ Successful
**TypeScript**: No errors
**Ready to Run**: Yes

Verify with:
```bash
npm run build
```

---

## Quick Start Command

```bash
TRADING_MODE=paper npm run dev
```

This will start the bot with:
- 2% risk per trade (2x positions)
- 5% daily loss limit
- 6 max concurrent positions
- Signal threshold: 5.0 (very relaxed - trades weak setups)

---

## Configuration Assessment

**Current Profile**: Profile A+ (Mild Aggression + Signal Relaxation)

| Aspect | Rating | Status |
|--------|--------|--------|
| Safety | ⚠️ Medium | Kill switch active, but aggressive |
| Profitability | 🟡 Moderate | 2x P&L potential, more trades |
| Stability | 🟡 Medium | Higher volatility expected |
| Complexity | ✅ Simple | Easy to monitor |
| Risk of Ruin | ⚠️ Moderate | Signal threshold very relaxed |

**Recommendation**: Monitor for 1-2 days, then decide:
- ✅ If win rate >50%: Continue or even escalate to Profile B
- ⚠️ If win rate 45-50%: Keep as-is or revert to 6.5
- ❌ If win rate <45%: Revert to Profile A (6.5) or original (7.0)

---

## Key Decision Point: Signal Threshold 5.0

⚠️ **Your current signal threshold (5.0) is VERY relaxed**

This means the bot will trade setups that are:
- Lower quality than standard
- More frequent but possibly weaker
- Potentially lower win rate
- More volume but less precision

**Monitor closely for:**
1. Are 5.0 score setups profitable?
2. Do they have acceptable win rate?
3. Is the extra volume worth the lower quality?

If yes → Keep at 5.0 or go even lower (Profile B/C)
If no → Revert to 6.5 or 7.0

---

**Document Created**: 2026-03-03
**Configuration Snapshot**: PROFILE A+ (Very Aggressive Signals)
**Next Review**: After 1-2 days of paper trading

