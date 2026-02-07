# Strategy Configuration Examples

This document provides different configuration templates for various trading styles and market conditions.

## 1. Conservative Scalping Strategy

**Best for**: Beginners, volatile markets, risk-averse traders

```env
# Trading Configuration
POSITION_SIZE=5
PROFIT_TARGET_PERCENT=0.08
STOP_LOSS_PERCENT=0.05
MAX_OPEN_POSITIONS=1
LEVERAGE=3
MAX_DAILY_LOSS=200
MAX_POSITION_SIZE=25

# Strategy Configuration
RSI_PERIOD=14
RSI_OVERBOUGHT=75
RSI_OVERSOLD=25
```

**Characteristics**:
- Small position sizes
- Tight stop losses
- Single position at a time
- Low leverage
- Conservative entry signals (RSI extremes)

**Expected Performance**:
- Win rate: ~65-70%
- Average profit per trade: 0.08%
- Max drawdown: Limited to $200/day
- Trading frequency: 5-10 trades/day

---

## 2. Balanced Scalping Strategy

**Best for**: Intermediate traders, normal market conditions

```env
# Trading Configuration
POSITION_SIZE=10
PROFIT_TARGET_PERCENT=0.12
STOP_LOSS_PERCENT=0.08
MAX_OPEN_POSITIONS=2
LEVERAGE=5
MAX_DAILY_LOSS=500
MAX_POSITION_SIZE=50

# Strategy Configuration
RSI_PERIOD=14
RSI_OVERBOUGHT=70
RSI_OVERSOLD=30
```

**Characteristics**:
- Medium position sizes
- Balanced risk-reward (1.5:1)
- Can hold 2 positions
- Moderate leverage
- Standard RSI thresholds

**Expected Performance**:
- Win rate: ~60-65%
- Average profit per trade: 0.12%
- Max drawdown: Limited to $500/day
- Trading frequency: 10-20 trades/day

---

## 3. Aggressive Scalping Strategy

**Best for**: Experienced traders, high-volume trading

```env
# Trading Configuration
POSITION_SIZE=20
PROFIT_TARGET_PERCENT=0.15
STOP_LOSS_PERCENT=0.12
MAX_OPEN_POSITIONS=3
LEVERAGE=8
MAX_DAILY_LOSS=1000
MAX_POSITION_SIZE=100

# Strategy Configuration
RSI_PERIOD=10
RSI_OVERBOUGHT=65
RSI_OVERSOLD=35
```

**Characteristics**:
- Large position sizes
- Wider profit targets
- Multiple simultaneous positions
- Higher leverage
- More sensitive RSI (shorter period)

**Expected Performance**:
- Win rate: ~55-60%
- Average profit per trade: 0.15%
- Max drawdown: Limited to $1000/day
- Trading frequency: 20-40 trades/day

---

## 4. High-Frequency Micro Scalping

**Best for**: Ultra-short-term trading, stable markets

```env
# Trading Configuration
POSITION_SIZE=15
PROFIT_TARGET_PERCENT=0.05
STOP_LOSS_PERCENT=0.03
MAX_OPEN_POSITIONS=4
LEVERAGE=10
MAX_DAILY_LOSS=800
MAX_POSITION_SIZE=75

# Strategy Configuration
RSI_PERIOD=7
RSI_OVERBOUGHT=68
RSI_OVERSOLD=32
```

**Characteristics**:
- Very tight profit targets
- Very tight stop losses
- Multiple positions
- High leverage
- Fast RSI period for quick signals

**Expected Performance**:
- Win rate: ~70-75% (required due to small targets)
- Average profit per trade: 0.05%
- Max drawdown: Limited to $800/day
- Trading frequency: 40-80 trades/day

---

## 5. Trend Following Scalper

**Best for**: Trending markets, capturing momentum

```env
# Trading Configuration
POSITION_SIZE=12
PROFIT_TARGET_PERCENT=0.2
STOP_LOSS_PERCENT=0.1
MAX_OPEN_POSITIONS=2
LEVERAGE=6
MAX_DAILY_LOSS=600
MAX_POSITION_SIZE=60

# Strategy Configuration
RSI_PERIOD=20
RSI_OVERBOUGHT=65
RSI_OVERSOLD=35
```

**Characteristics**:
- Wider profit targets for trends
- Longer RSI period for trend confirmation
- Moderate position sizes
- Less frequent but larger moves

**Expected Performance**:
- Win rate: ~50-55%
- Average profit per trade: 0.2%
- Max drawdown: Limited to $600/day
- Trading frequency: 5-15 trades/day

---

## 6. Low Volatility Strategy

**Best for**: Stable markets, overnight trading

```env
# Trading Configuration
POSITION_SIZE=8
PROFIT_TARGET_PERCENT=0.06
STOP_LOSS_PERCENT=0.04
MAX_OPEN_POSITIONS=2
LEVERAGE=4
MAX_DAILY_LOSS=300
MAX_POSITION_SIZE=40

# Strategy Configuration
RSI_PERIOD=21
RSI_OVERBOUGHT=78
RSI_OVERSOLD=22
```

**Characteristics**:
- Small, precise moves
- Extreme RSI levels for low volatility
- Conservative sizing
- Lower leverage

**Expected Performance**:
- Win rate: ~70%
- Average profit per trade: 0.06%
- Max drawdown: Limited to $300/day
- Trading frequency: 8-15 trades/day

---

## Product-Specific Configurations

### Bitcoin (BTCUSD) - Product ID: 27
```env
PRODUCT_ID=27
PRODUCT_SYMBOL=BTCUSD
POSITION_SIZE=10
PROFIT_TARGET_PERCENT=0.1
STOP_LOSS_PERCENT=0.08
```
- High liquidity
- Standard parameters work well
- Best during US/Asian trading hours

### Ethereum (ETHUSD) - Product ID: 3136
```env
PRODUCT_ID=3136
PRODUCT_SYMBOL=ETHUSD
POSITION_SIZE=50
PROFIT_TARGET_PERCENT=0.12
STOP_LOSS_PERCENT=0.09
```
- High liquidity
- Slightly wider targets due to volatility
- Good for scalping

### Low Liquidity Altcoins
```env
POSITION_SIZE=5
PROFIT_TARGET_PERCENT=0.2
STOP_LOSS_PERCENT=0.15
MAX_OPEN_POSITIONS=1
LEVERAGE=3
```
- Smaller positions
- Wider spreads require larger targets
- Be extra cautious

---

## Market Condition Adjustments

### High Volatility (VIX > 30)
```env
STOP_LOSS_PERCENT=0.15
PROFIT_TARGET_PERCENT=0.25
LEVERAGE=3
MAX_OPEN_POSITIONS=1
```

### Low Volatility (VIX < 15)
```env
STOP_LOSS_PERCENT=0.04
PROFIT_TARGET_PERCENT=0.06
LEVERAGE=8
MAX_OPEN_POSITIONS=3
```

### Pre-News Events
```env
# Consider stopping the bot or:
POSITION_SIZE=5
MAX_OPEN_POSITIONS=1
LEVERAGE=2
```

### Weekend Trading
```env
# Lower liquidity on weekends:
POSITION_SIZE=8
MAX_OPEN_POSITIONS=2
LEVERAGE=4
```

---

## Risk Management Guidelines

### Position Sizing Formula
```
Position Size = (Account Balance × Risk%) / (Entry Price - Stop Loss Price)
```

### Recommended Risk per Trade
- Conservative: 0.5-1% of account
- Moderate: 1-2% of account
- Aggressive: 2-3% of account (not recommended)

### Daily Loss Limits
- Set MAX_DAILY_LOSS to 2-5% of total account balance
- Stop trading for the day if limit is hit
- Review strategy if consistently hitting limit

### Leverage Guidelines
- Beginners: 2-3x
- Intermediate: 3-7x
- Advanced: 7-10x
- Never exceed 10x for scalping

---

## Performance Monitoring

### Key Metrics to Track

1. **Win Rate**: Aim for >55% for scalping
2. **Risk-Reward Ratio**: Minimum 1:1.5
3. **Profit Factor**: (Gross Profit / Gross Loss) > 1.5
4. **Maximum Drawdown**: Should not exceed MAX_DAILY_LOSS
5. **Average Trade Duration**: Should be <30 minutes for scalping

### When to Adjust Strategy

- Win rate drops below 50% → Increase signal strength threshold
- Too few trades → Relax RSI thresholds
- Too many losses in a row (>5) → Stop and reassess
- Hitting daily loss limit frequently → Reduce leverage/position size

---

## Testing Checklist

Before going live with any configuration:

- [ ] Backtest on historical data
- [ ] Test on testnet for at least 1 week
- [ ] Start with minimum position sizes
- [ ] Monitor for at least 50 trades
- [ ] Calculate actual win rate and profit factor
- [ ] Verify risk management is working
- [ ] Check that stops are being respected
- [ ] Ensure no slippage issues

---

## Configuration Best Practices

1. **Start Conservative**: Use conservative settings first
2. **One Change at a Time**: Only adjust one parameter when optimizing
3. **Paper Trade First**: Test all changes on testnet
4. **Document Changes**: Keep a log of what works and what doesn't
5. **Market Conditions**: Adjust based on current volatility
6. **Regular Review**: Review performance weekly and adjust
7. **Stop Losses**: Never disable stop losses
8. **Position Limits**: Always enforce position limits

---

## Common Mistakes to Avoid

❌ **Over-leveraging**: Using leverage >10x
❌ **No Stop Loss**: Trading without stops
❌ **Too Many Positions**: Exceeding risk limits
❌ **Ignoring Volatility**: Using same settings in all conditions
❌ **Revenge Trading**: Increasing size after losses
❌ **Over-optimization**: Fitting strategy to past data only
❌ **Ignoring Fees**: Not accounting for maker/taker fees
❌ **No Daily Limits**: Trading without daily loss limits

---

Remember: There's no one-size-fits-all configuration. Adjust parameters based on your risk tolerance, account size, and market conditions. Always test thoroughly before using real money! 📊
