# ARES
Automated Risk-controlled Execution Scalper for Delta Exchange futures trading.

## Overview
ARES is a WebSocket-first, rule-based crypto futures scalping engine for Delta Exchange India, built with strict risk controls, deterministic execution, and production-grade safety systems.

## Features
- Real-time market analysis via WebSocket
- Technical indicators: RSI, SMA, EMA, Bollinger Bands, and more
- Risk management: daily loss limits, position limits, and risk-reward validation
- Smart order execution: limit orders, post-only orders, and automated SL/TP
- Comprehensive logging with Winston and file rotation
- Graceful shutdown with order/position cleanup

## Architecture
```
src/
├── main.ts                 # Entrypoint
├── delta/                  # Delta Exchange integration
├── config/                 # Shared configuration
├── ai/                     # AI veto-only layer (optional)
└── ...
```

## Prerequisites
- Node.js >= 18.x
- TypeScript >= 5.x
- Delta Exchange account with API credentials

## Installation
1. Install dependencies:
```bash
npm install
```

2. Create `.env` from template:
```bash
cp .env.example .env
```

3. Configure your API credentials and trading parameters in `.env`.

## Quick Start Guide
## Step 1: Setup Delta Exchange Account
1. Create an account on Delta Exchange.
2. Complete KYC.
3. Deposit funds (USDT or other supported currencies).
4. Enable 2FA.

## Step 2: Generate API Credentials
1. Go to `Account Settings` → `API Management`.
2. Click `Create New API Key`.
3. Set permissions: Trading (required) and Read Data (required).
4. IP Whitelist (recommended): add your server's public IP and your home IP for local testing.
5. Save the API key and secret securely.

Never share your API secret or commit it to git.

## Step 3: Install and Configure
```bash
# Clone repository
git clone <your-repo-url>
cd ares

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
```

### Example .env Configuration
```env
# Delta Exchange API Credentials
DELTA_API_KEY=your_api_key_here
DELTA_API_SECRET=your_api_secret_here

# Base URLs (India)
DELTA_BASE_URL=https://api.india.delta.exchange
DELTA_WS_URL=wss://socket.india.delta.exchange

# Product Configuration
PRODUCT_ID=27
PRODUCT_SYMBOL=BTCUSD

# Trading Parameters
POSITION_SIZE=10
PROFIT_TARGET_PERCENT=0.15
STOP_LOSS_PERCENT=0.1
MAX_OPEN_POSITIONS=2
LEVERAGE=5

# Risk Management
MAX_DAILY_LOSS=500
MAX_POSITION_SIZE=50

# Strategy Parameters
RSI_PERIOD=14
RSI_OVERBOUGHT=70
RSI_OVERSOLD=30

# Logging
LOG_LEVEL=info
```

## Step 4: Test on Testnet (Recommended)
Before using real funds, test on the testnet:
```env
# Change URLs to testnet
DELTA_BASE_URL=https://cdn-ind.testnet.deltaex.org
DELTA_WS_URL=wss://socket-ind.testnet.deltaex.org

# Use testnet API keys (create separate keys for testnet)
DELTA_API_KEY=your_testnet_api_key
DELTA_API_SECRET=your_testnet_api_secret
```

Create a testnet account at `https://demo.delta.exchange`.

## Step 5: Run the Bot
### Development Mode (with auto-restart)
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm run start
```

### Using PM2 (Recommended for Production)
```bash
# Install PM2 globally
npm install -g pm2

# Start bot
pm2 start dist/main.js --name ares

# View logs
pm2 logs ares

# Stop bot
pm2 stop ares

# Restart bot
pm2 restart ares

# Auto-start on system reboot
pm2 startup
pm2 save
```

## Step 6: Monitor the Bot
### Check Logs
```bash
# Real-time logs
tail -f logs/combined.log

# Error logs only
tail -f logs/error.log

# Using PM2
pm2 logs ares
```

### Monitor Performance
The bot logs status every minute:
- Current position
- Open orders
- Daily P&L
- Trade count

Example log output:
```text
2024-01-15 10:23:45 [info]: Bot Status: {
  running: true,
  position: { size: 10, entryPrice: '43250.5', unrealizedPnL: '25.3' },
  openOrders: 0,
  riskStats: {
    dailyPnL: 123.45,
    dailyTrades: 8,
    openPositionsCount: 1,
    dailyLossLimitReached: false,
    maxPositionsReached: false
  }
}
```

## Step 7: Stop the Bot
### Graceful Shutdown
```bash
# Press Ctrl+C in terminal
# Or send SIGTERM
kill -TERM <pid>
```

The bot will:
- Cancel all open orders.
- Close open positions (optional, based on config).
- Disconnect WebSocket.
- Save final logs.

### Emergency Stop
If the bot is unresponsive:
```bash
# Force kill (not recommended - may leave open orders)
kill -9 <pid>
```

Manually cancel any open orders on Delta Exchange afterward.

## Strategy Configuration Examples
This section provides configuration templates for different trading styles and market conditions.

### 1. Conservative Scalping Strategy
Best for beginners, volatile markets, and risk-averse traders.
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

Characteristics:
- Small position sizes.
- Tight stop losses.
- Single position at a time.
- Low leverage.
- Conservative entry signals (RSI extremes).

Expected performance:
- Win rate: ~65-70%.
- Average profit per trade: 0.08%.
- Max drawdown: limited to $200/day.
- Trading frequency: 5-10 trades/day.

### 2. Balanced Scalping Strategy
Best for intermediate traders and normal market conditions.
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

Characteristics:
- Medium position sizes.
- Balanced risk-reward (1.5:1).
- Can hold 2 positions.
- Moderate leverage.
- Standard RSI thresholds.

Expected performance:
- Win rate: ~60-65%.
- Average profit per trade: 0.12%.
- Max drawdown: limited to $500/day.
- Trading frequency: 10-20 trades/day.

### 3. Aggressive Scalping Strategy
Best for experienced traders and high-volume trading.
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

Characteristics:
- Large position sizes.
- Wider profit targets.
- Multiple simultaneous positions.
- Higher leverage.
- More sensitive RSI (shorter period).

Expected performance:
- Win rate: ~55-60%.
- Average profit per trade: 0.15%.
- Max drawdown: limited to $1000/day.
- Trading frequency: 20-40 trades/day.

### 4. High-Frequency Micro Scalping
Best for ultra-short-term trading and stable markets.
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

Characteristics:
- Very tight profit targets.
- Very tight stop losses.
- Multiple positions.
- High leverage.
- Fast RSI period for quick signals.

Expected performance:
- Win rate: ~70-75% (required due to small targets).
- Average profit per trade: 0.05%.
- Max drawdown: limited to $800/day.
- Trading frequency: 40-80 trades/day.

### 5. Trend Following Scalper
Best for trending markets and capturing momentum.
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

Characteristics:
- Wider profit targets for trends.
- Longer RSI period for trend confirmation.
- Moderate position sizes.
- Less frequent but larger moves.

Expected performance:
- Win rate: ~50-55%.
- Average profit per trade: 0.2%.
- Max drawdown: limited to $600/day.
- Trading frequency: 5-15 trades/day.

### 6. Low Volatility Strategy
Best for stable markets and overnight trading.
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

Characteristics:
- Small, precise moves.
- Extreme RSI levels for low volatility.
- Conservative sizing.
- Lower leverage.

Expected performance:
- Win rate: ~70%.
- Average profit per trade: 0.06%.
- Max drawdown: limited to $300/day.
- Trading frequency: 8-15 trades/day.

## Product-Specific Configurations
### Bitcoin (BTCUSD) - Product ID: 27
```env
PRODUCT_ID=27
PRODUCT_SYMBOL=BTCUSD
POSITION_SIZE=10
PROFIT_TARGET_PERCENT=0.1
STOP_LOSS_PERCENT=0.08
```
High liquidity and standard parameters work well. Best during US/Asian trading hours.

### Ethereum (ETHUSD) - Product ID: 3136
```env
PRODUCT_ID=3136
PRODUCT_SYMBOL=ETHUSD
POSITION_SIZE=50
PROFIT_TARGET_PERCENT=0.12
STOP_LOSS_PERCENT=0.09
```
High liquidity and slightly wider targets due to volatility.

### Low Liquidity Altcoins
```env
POSITION_SIZE=5
PROFIT_TARGET_PERCENT=0.2
STOP_LOSS_PERCENT=0.15
MAX_OPEN_POSITIONS=1
LEVERAGE=3
```
Smaller positions and wider spreads require larger targets.

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
POSITION_SIZE=5
MAX_OPEN_POSITIONS=1
LEVERAGE=2
```

### Weekend Trading
```env
POSITION_SIZE=8
MAX_OPEN_POSITIONS=2
LEVERAGE=4
```

## Common Trading Scenarios
### Conservative Trading
```env
POSITION_SIZE=5
PROFIT_TARGET_PERCENT=0.1
STOP_LOSS_PERCENT=0.05
MAX_OPEN_POSITIONS=1
LEVERAGE=3
MAX_DAILY_LOSS=200
```

### Aggressive Trading
```env
POSITION_SIZE=20
PROFIT_TARGET_PERCENT=0.2
STOP_LOSS_PERCENT=0.15
MAX_OPEN_POSITIONS=5
LEVERAGE=10
MAX_DAILY_LOSS=1000
```

### Scalping (High Frequency)
```env
POSITION_SIZE=15
PROFIT_TARGET_PERCENT=0.05
STOP_LOSS_PERCENT=0.03
MAX_OPEN_POSITIONS=3
LEVERAGE=7
MAX_DAILY_LOSS=500
```

## Risk Management Guidelines
### Position Sizing Formula
```
Position Size = (Account Balance × Risk%) / (Entry Price - Stop Loss Price)
```

### Recommended Risk per Trade
- Conservative: 0.5-1% of account.
- Moderate: 1-2% of account.
- Aggressive: 2-3% of account (not recommended).

### Daily Loss Limits
- Set `MAX_DAILY_LOSS` to 2-5% of total account balance.
- Stop trading for the day if the limit is hit.
- Review the strategy if you consistently hit the limit.

### Leverage Guidelines
- Beginners: 2-3x.
- Intermediate: 3-7x.
- Advanced: 7-10x.
- Never exceed 10x for scalping.

## Performance Monitoring
### Key Metrics to Track
1. Win rate: aim for >55% for scalping.
2. Risk-reward ratio: minimum 1:1.5.
3. Profit factor: (gross profit / gross loss) > 1.5.
4. Maximum drawdown: should not exceed `MAX_DAILY_LOSS`.
5. Average trade duration: should be <30 minutes for scalping.

### When to Adjust Strategy
- Win rate drops below 50%: increase signal strength threshold.
- Too few trades: relax RSI thresholds.
- Too many losses in a row (>5): stop and reassess.
- Hitting daily loss limit frequently: reduce leverage or position size.

## Testing Checklist
Before going live with any configuration:
- Backtest on historical data.
- Test on testnet for at least 1 week.
- Start with minimum position sizes.
- Monitor for at least 50 trades.
- Calculate actual win rate and profit factor.
- Verify risk management is working.
- Check that stops are being respected.
- Ensure no slippage issues.

## Configuration Best Practices
1. Start conservative: use conservative settings first.
2. One change at a time: adjust a single parameter when optimizing.
3. Paper trade first: test all changes on testnet.
4. Document changes: keep a log of what works and what does not.
5. Market conditions: adjust based on current volatility.
6. Regular review: review performance weekly and adjust.
7. Stop losses: never disable stop losses.
8. Position limits: always enforce position limits.

## Common Mistakes to Avoid
- Over-leveraging: using leverage >10x.
- No stop loss: trading without stops.
- Too many positions: exceeding risk limits.
- Ignoring volatility: using the same settings in all conditions.
- Revenge trading: increasing size after losses.
- Over-optimization: fitting strategy to past data only.
- Ignoring fees: not accounting for maker/taker fees.
- No daily limits: trading without daily loss limits.

## Optimization Tips
### Choose the Right Product
- Start with high liquidity pairs (BTCUSD, ETHUSD).
- Check 24h volume on Delta Exchange.
- Avoid low liquidity products (wider spreads).

### Optimize Entry/Exit
- Use post-only orders to earn maker fees.
- Adjust profit target based on volatility.
- Set realistic stop losses.

### Risk Management
- Never risk more than 1-2% per trade.
- Set `MAX_DAILY_LOSS` to something you can afford.
- Start with lower leverage (3-5x).

### Market Conditions
- Best during high volume periods.
- Avoid news events (high volatility).
- Asian trading hours often have high volume.

### Server Location
- Host on AWS Tokyo (closest to Delta servers).
- Low latency is crucial for scalping.
- Use a stable internet connection.

## Troubleshooting
### Bot Won't Start
```bash
# Check if all dependencies installed
npm install

# Verify .env file exists and is configured
cat .env

# Check for syntax errors
npm run build
```

### No Trades Executing
- Check RSI levels in logs.
- Verify sufficient balance.
- Ensure not hitting daily loss limit.
- Check if leverage is set correctly.
- Review signal strength threshold.

### Orders Not Filling
- Reduce use of post-only orders.
- Adjust limit prices closer to market.
- Check orderbook liquidity.
- Consider using market orders (higher fees).

### High Losses
- Reduce leverage immediately.
- Increase stop loss percentage.
- Reduce position size.
- Check strategy parameters.
- Consider market conditions.

## Getting Help
1. Check logs: `logs/error.log`.
2. Review configuration: `.env` settings.
3. Delta Exchange status: `https://status.delta.exchange`.
4. API documentation: `https://docs.delta.exchange`.

## Safety Checklist
Before running with real funds:
- Tested on testnet.
- API keys have IP whitelist.
- API keys have minimal permissions.
- Set reasonable position sizes.
- Configured daily loss limit.
- Monitoring setup in place.
- Understand all configuration parameters.
- Have emergency stop procedure.
- Backed up configuration.
- Read all documentation.

Remember: there is no one-size-fits-all configuration. Adjust parameters based on your risk tolerance, account size, and market conditions. Always test thoroughly before using real funds.

## Configuration
### API Configuration
- `DELTA_API_KEY`: Your Delta Exchange API key
- `DELTA_API_SECRET`: Your Delta Exchange API secret
- `DELTA_BASE_URL`: API base URL (default: `https://api.india.delta.exchange`)
- `DELTA_WS_URL`: WebSocket URL (default: `wss://socket.india.delta.exchange`)

### Trading Configuration
- `TRADING_MODE`: `live` or `paper`
- `POSITION_SIZE`: Size of each position
- `PROFIT_TARGET_PERCENT`: Take profit percentage
- `STOP_LOSS_PERCENT`: Stop loss percentage
- `MAX_OPEN_POSITIONS`: Maximum concurrent positions
- `LEVERAGE`: Trading leverage
- `MAX_DAILY_LOSS`: Maximum allowed daily loss
- `MAX_POSITION_SIZE`: Maximum position size

### Strategy Configuration
- `RSI_PERIOD`: RSI calculation period
- `RSI_OVERBOUGHT`: RSI overbought level
- `RSI_OVERSOLD`: RSI oversold level

## Usage
### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm run start
```

## AI Veto Layer (Optional)
AI is a post-strategy veto only. It must never generate trades, adjust risk, or touch execution.

Flow:
`Market → Indicators → Strategy → Risk → AI Veto → Execution`

Config:
- `AI_PROVIDER` (`ollama` or `openai`, default `ollama`)
- `OLLAMA_URL`, `OLLAMA_MODEL`
- `OPENAI_API_KEY`, `OPENAI_MODEL`

## Logging
Use standardized tags for logs, metrics, and alerts:
- `ARES.MARKET`
- `ARES.INDICATORS`
- `ARES.STRATEGY`
- `ARES.RISK`
- `ARES.EXECUTION`
- `ARES.KILL`
- `ARES.PAPER`
- `ARES.BACKTEST`

Example:
`[ARES.RISK] Trade blocked — MAX_DAILY_LOSS`

Logs are stored in `logs/`:
- `combined.log`: All logs
- `error.log`: Error logs only

## Delta Endpoints
Defaults target Delta Exchange India (production).
Testnet values:
- `DELTA_BASE_URL=https://cdn-ind.testnet.deltaex.org`
- `DELTA_WS_URL=wss://socket-ind.testnet.deltaex.org`

## Safety Notes
- Crypto trading carries significant risk. Never trade with more than you can afford to lose.
- Always test on testnet or paper mode before live funds.
- Keep API keys secure and restrict permissions to trading only.

## Development
- `npm run dev`: Run in watch mode
- `npm run lint`: Type-check only (`tsc --noEmit`)
- `npm run build`: Compile to `dist/`
- `npm run start`: Run compiled output
- `npm run clean`: Remove `dist/`

## License
MIT License. See `LICENSE`.

## Disclaimer
This software is for educational purposes only. Use at your own risk. The authors are not responsible for any financial losses incurred while using this bot.
