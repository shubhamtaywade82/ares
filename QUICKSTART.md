# Quick Start Guide

## Step 1: Setup Delta Exchange Account

1. Create an account on Delta Exchange.
2. Complete KYC.
3. Deposit funds (USDT or other supported currencies).
4. Enable 2FA.

## Step 2: Generate API Credentials

1. Go to Account Settings → API Management.
2. Click Create New API Key.
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

# Edit .env with your details
nano .env
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
DELTA_PRODUCT_SYMBOL=BTCUSD
DELTA_PRODUCT_ID=

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
# Build
npm run build

# Run
npm start
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
```
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
1. Cancel all open orders
2. Close open positions (optional - configure as needed)
3. Disconnect WebSocket
4. Save final logs

### Emergency Stop
If bot is unresponsive:
```bash
# Force kill (not recommended - may leave open orders)
kill -9 <pid>

# Then manually cancel orders on Delta Exchange
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

## Optimization Tips

### 1. Choose the Right Product
- Start with high liquidity pairs (BTCUSD, ETHUSD)
- Check 24h volume on Delta Exchange
- Avoid low liquidity products (wider spreads)

### 2. Optimize Entry/Exit
- Use post_only orders to earn maker fees
- Adjust profit target based on volatility
- Set realistic stop losses

### 3. Risk Management
- Never risk more than 1-2% per trade
- Set MAX_DAILY_LOSS to something you can afford
- Start with lower leverage (3-5x)

### 4. Market Conditions
- Best during high volume periods
- Avoid news events (high volatility)
- Asian trading hours often have high volume

### 5. Server Location
- Host on AWS Tokyo (closest to Delta servers)
- Low latency is crucial for scalping
- Use stable internet connection

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
- Check RSI levels in logs
- Verify sufficient balance
- Ensure not hitting daily loss limit
- Check if leverage is set correctly
- Review signal strength threshold

### Orders Not Filling
- Reduce use of post_only orders
- Adjust limit prices closer to market
- Check orderbook liquidity
- Consider using market orders (higher fees)

### High Losses
- Reduce leverage immediately
- Increase stop loss percentage
- Reduce position size
- Check strategy parameters
- Consider market conditions

## Getting Help

1. **Check Logs**: Always start with `logs/error.log`
2. **Review Configuration**: Verify `.env` settings
3. **Delta Exchange Status**: Check [status.delta.exchange](https://status.delta.exchange)
4. **API Documentation**: [docs.delta.exchange](https://docs.delta.exchange)

## Safety Checklist

Before running with real funds:

- [ ] Tested on testnet
- [ ] API keys have IP whitelist
- [ ] API keys have minimal permissions
- [ ] Set reasonable position sizes
- [ ] Configured daily loss limit
- [ ] Monitoring setup in place
- [ ] Understand all configuration parameters
- [ ] Have emergency stop procedure
- [ ] Backed up configuration
- [ ] Read all documentation

---

**Remember**: Start small, test thoroughly, and gradually increase position sizes as you gain confidence! 🎯
