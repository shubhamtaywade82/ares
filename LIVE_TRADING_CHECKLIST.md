# ARES Live Trading Readiness Checklist

**Pre-Production Verification Checklist for Full-Pledge Live Trading on Delta Exchange**

---

## Executive Summary

This checklist ensures ARES is production-ready before deploying real capital. Complete **ALL** items before enabling live trading.

**⚠️ CRITICAL:** Start with **minimum position sizes** (0.001 BTC) for the first week.

---

## Section 1: Pre-Deployment Verification

### 1.1 Account & API Setup

- [ ] Delta Exchange account created and verified
- [ ] Account has sufficient balance (minimum $500 USD equivalent)
- [ ] API key generated with correct permissions:
  - [ ] Place orders (post-only preferred)
  - [ ] Cancel orders
  - [ ] View positions
  - [ ] View orders
  - [ ] View balances
  - [ ] Settle positions
- [ ] API key and secret stored securely (.env file)
- [ ] API key NOT committed to Git
- [ ] IP whitelisting configured (if available on Delta)
- [ ] 2FA enabled on account
- [ ] Backup API key generated (for recovery)

### 1.2 Environment Configuration

- [ ] `.env` file created with ALL required variables
- [ ] `TRADING_MODE=live` (will be set during deployment)
- [ ] `DELTA_API_KEY` set correctly
- [ ] `DELTA_API_SECRET` set correctly
- [ ] `DELTA_PRODUCT_SYMBOL` verified against current Delta offerings
- [ ] `DELTA_PRODUCT_ID` verified (if configured)
- [ ] Risk limits set conservatively:
  - [ ] `RISK_DAILY_LOSS_PCT` ≤ 2.0 (max 2% loss per day)
  - [ ] `RISK_POSITION_SIZE_PCT` ≤ 1.0 (max 1% per position)
  - [ ] `RISK_MAX_LEVERAGE` matches Delta account limit
- [ ] `PAPER_BALANCE` removed from production .env
- [ ] All credentials use environment variables ONLY
- [ ] `.env` added to `.gitignore` (verify with `git check-ignore .env`)

### 1.3 Code Review & Audit

- [ ] Code reviewed by second person (pair review)
- [ ] No hardcoded API credentials in source code
- [ ] No `console.log()` statements in production code
- [ ] All logging uses `logger` (Pino)
- [ ] Error handling on all external API calls
- [ ] Timeout protection on all network requests
- [ ] Kill switch is reachable from all critical paths
- [ ] No infinite loops or busy waits
- [ ] All dependencies are up-to-date (`npm audit`)
- [ ] No known vulnerabilities (`npm audit fix`)
- [ ] TypeScript strict mode enabled (in tsconfig.json)

### 1.4 Testing Verification

- [ ] Unit tests passing (≥80% code coverage)
- [ ] Integration tests passing
- [ ] Build successful with no TypeScript errors
- [ ] 30+ minute paper trading test completed
- [ ] ≥3 complete trade cycles in paper mode
- [ ] Win rate >50% in paper mode (or acceptable for strategy)
- [ ] Paper mode P&L positive overall
- [ ] No memory leaks (memory stable for 1+ hours)
- [ ] CPU usage remains <20% under normal conditions
- [ ] WebSocket reconnection tested and working
- [ ] Order/position recovery after disconnect verified

### 1.5 Risk Management Configuration

- [ ] Daily loss limit configured (`RISK_DAILY_LOSS_PCT`)
- [ ] Position size limit configured (`RISK_POSITION_SIZE_PCT`)
- [ ] Leverage limits set per symbol
- [ ] Kill switch handler tested manually
- [ ] Kill switch will close all positions on trigger
- [ ] Orphan position detection enabled (`BOOT_BLOCK_ON_ORPHAN_POSITIONS=true`)
- [ ] Manual fallback procedure documented (how to close positions if bot fails)
- [ ] Kill switch cannot be bypassed (code review verified)

### 1.6 Monitoring & Alerts

- [ ] Monitoring dashboard created (if using Grafana/Prometheus)
- [ ] Alert rules configured:
  - [ ] High memory usage (>200MB)
  - [ ] High CPU usage (>25%)
  - [ ] Error rate spike (>10 errors/min)
  - [ ] Kill switch triggered
  - [ ] Daily loss limit breached
  - [ ] WS connection lost >5 mins
- [ ] Alert recipients defined (email, Slack, PagerDuty, etc.)
- [ ] Log aggregation service configured (if using ELK/Datadog/etc.)
- [ ] Critical log patterns configured for immediate alert
- [ ] Audit log storage configured (immutable, long-term)

---

## Section 2: First Week Operations

### 2.1 Day 1: Paper to Live Transition

#### Before Starting
- [ ] Account balance verified (check Delta Exchange web UI)
- [ ] Market is open (Delta is always open, verify connectivity)
- [ ] No existing open positions or orders
- [ ] Stop-loss orders can be placed (verify with test order)
- [ ] Take-profit orders can be placed (verify with test order)
- [ ] Post-only orders work correctly
- [ ] All monitoring dashboards loaded and ready
- [ ] Escalation contacts available
- [ ] Kill switch tested one more time

#### Configuration for First Week
```bash
# Very conservative settings for first week
TRADING_MODE=live
RISK_DAILY_LOSS_PCT=0.5  # Only 0.5% max daily loss for now
RISK_POSITION_SIZE_PCT=0.1  # Only 0.1% per position
DELTA_PRODUCT_SYMBOL=BTCUSD  # Single symbol only
BOOT_BLOCK_ON_ORPHAN_POSITIONS=true
BOOT_CLOSE_ORPHAN_POSITIONS=false
```

#### Deployment Steps
1. [ ] SSH to production server (or local)
2. [ ] Pull latest code: `git pull origin main`
3. [ ] Install: `npm install`
4. [ ] Build: `npm run build`
5. [ ] Start with PM2 or systemd (see deployment guide below)
6. [ ] Monitor logs: `tail -f /var/log/ares/app.log` (or equivalent)

#### First Trade Validation
- [ ] Wait for first signal (may take hours if low volatility)
- [ ] Monitor entry order:
  - [ ] Order appears in Delta web UI
  - [ ] Shows correct size, price, side
  - [ ] Is post-only (not taking liquidity)
- [ ] Monitor fill:
  - [ ] Entry fills and price logged
  - [ ] SL and TP orders appear in Delta web UI
  - [ ] SL price is correct (entry ± ATR)
  - [ ] TP price is correct (RR ratio met)
- [ ] Watch position mark-to-market:
  - [ ] Position shows in Delta web UI
  - [ ] P&L calculation matches bot logs
  - [ ] Mark price updates every second
- [ ] Wait for exit (TP or SL):
  - [ ] Exit order fills
  - [ ] Position closes completely
  - [ ] Realized P&L matches logs
  - [ ] No orphaned positions

#### First 24 Hours Monitoring
- [ ] Monitor every 1 hour in first 24 hours
- [ ] Check for:
  - [ ] Any errors in logs
  - [ ] Memory usage growth
  - [ ] CPU spikes
  - [ ] Unexpected trade behavior
  - [ ] Order fills mismatches
  - [ ] P&L calculation accuracy
- [ ] Daily loss limit NOT breached
- [ ] No kill switch triggered
- [ ] All positions closed properly

### 2.2 Week 1: Gradual Increase

#### Day 2-3: Single Symbol, Small Positions
- [ ] Increase `RISK_POSITION_SIZE_PCT` to 0.2
- [ ] Continue monitoring hourly
- [ ] Track all trades manually (spreadsheet):
  - [ ] Entry price, size
  - [ ] Exit price, reason (TP/SL/manual)
  - [ ] Actual P&L from Delta
  - [ ] Bot-calculated P&L
  - [ ] Match? Mark ✓

#### Day 4-5: Test Second Symbol
- [ ] Add second symbol to `DELTA_PRODUCT_SYMBOLS`
- [ ] Keep `RISK_POSITION_SIZE_PCT` at 0.2
- [ ] Verify:
  - [ ] No interference between symbols
  - [ ] Signals generate independently
  - [ ] Risk limits apply correctly across symbols
  - [ ] Global open trade limit respected

#### Day 6-7: Scale to Production
- [ ] Increase `RISK_POSITION_SIZE_PCT` to 0.5
- [ ] Increase `RISK_DAILY_LOSS_PCT` to 1.0
- [ ] Move to full symbol watchlist if desired
- [ ] Continue daily monitoring
- [ ] Prepare for week 2 autonomous operation

#### Weekly Review (End of Day 7)
- [ ] Total trades: [count]
- [ ] Winning trades: [count]
- [ ] Losing trades: [count]
- [ ] Win rate: [%]
- [ ] Total P&L: [amount USD]
- [ ] Max drawdown: [%]
- [ ] Any issues encountered:
  - [ ] List and resolution
- [ ] Strategy performing as expected? YES / NO
- [ ] Ready for full autonomous operation? YES / NO

---

## Section 3: Production Operations

### 3.1 Daily Operations Checklist

**Every Morning (before trading hours):**
- [ ] Check server is running: `ps aux | grep node`
- [ ] Check disk space: `df -h`
- [ ] Check logs for overnight errors: `tail -100 /var/log/ares/app.log`
- [ ] Verify API connectivity: Check first log entries for "WS connected"
- [ ] Check account balance on Delta (web UI)
- [ ] Review previous day's P&L

**Throughout Trading Day:**
- [ ] Monitor first trade of the day (automated alert on first [ARES.EXECUTION])
- [ ] Spot-check logs every 1-2 hours
- [ ] Monitor dashboard (memory, CPU, error rate)
- [ ] Check for any alerts triggered

**Every Evening:**
- [ ] Review day's trades:
  - [ ] Count of trades
  - [ ] P&L
  - [ ] Win rate
  - [ ] Any issues
- [ ] Review error logs
- [ ] Check memory/CPU charts for anomalies
- [ ] Verify next day's risk limits are correct

### 3.2 Weekly Operations

- [ ] Export full trade history from Delta
- [ ] Compare with bot's trade journal
- [ ] Verify P&L accuracy
- [ ] Review strategy performance:
  - [ ] Win rate
  - [ ] Average win/loss
  - [ ] Sharpe ratio
  - [ ] Max drawdown
- [ ] Review risk exposure:
  - [ ] Largest position size
  - [ ] Worst daily loss
  - [ ] Max concurrent positions
- [ ] Check for any warnings in logs
- [ ] Backup bot state and logs

### 3.3 Monthly Operations

- [ ] Full strategy performance review
- [ ] Evaluate need for parameter adjustments
- [ ] Review and renew API key if rotated
- [ ] Audit all logs for security
- [ ] Backup database/persistent state
- [ ] Plan next month's testing/improvements

---

## Section 4: Deployment & Infrastructure

### 4.1 Server Setup (Linux/Ubuntu)

```bash
# System dependencies
sudo apt-get update
sudo apt-get install -y nodejs npm git
node --version  # Should be ≥18

# Create app user
sudo useradd -m -s /bin/bash ares

# Create directories
sudo mkdir -p /opt/ares /var/log/ares /var/lib/ares
sudo chown -R ares:ares /opt/ares /var/log/ares /var/lib/ares

# Clone repository
cd /opt/ares
sudo -u ares git clone <repo-url> .
```

### 4.2 PM2 Setup (Recommended)

```bash
# Install PM2
sudo npm install -g pm2

# Create PM2 ecosystem config: /opt/ares/ecosystem.config.js
module.exports = {
  apps: [{
    name: 'ares',
    script: './dist/main.js',
    cwd: '/opt/ares',
    env: {
      TRADING_MODE: 'live',
      LOG_LEVEL: 'info',
      NODE_ENV: 'production',
    },
    env_file: '/opt/ares/.env',
    instances: 1,
    exec_mode: 'cluster',
    error_file: '/var/log/ares/error.log',
    out_file: '/var/log/ares/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    watch: false,  # Don't auto-reload in production
    ignore_watch: ['node_modules', 'dist'],
    max_memory_restart: '500M',
    kill_timeout: 3000,
    listen_timeout: 3000,
  }],
};

# Start
sudo -u ares pm2 start ecosystem.config.js

# Set to start on reboot
sudo pm2 startup -u ares --hp /home/ares
sudo -u ares pm2 save

# Monitor
pm2 monit
pm2 logs ares
```

### 4.3 Systemd Setup (Alternative)

```bash
# Create /etc/systemd/system/ares.service
[Unit]
Description=ARES Trading Bot
After=network.target

[Service]
Type=simple
User=ares
WorkingDirectory=/opt/ares
Environment="NODE_ENV=production"
Environment="TRADING_MODE=live"
EnvironmentFile=/opt/ares/.env
ExecStart=/usr/bin/node /opt/ares/dist/main.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/ares/app.log
StandardError=append:/var/log/ares/error.log
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable ares
sudo systemctl start ares
sudo systemctl status ares

# Monitor
sudo journalctl -u ares -f
```

### 4.4 Log Rotation

```bash
# Create /etc/logrotate.d/ares
/var/log/ares/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 ares ares
    sharedscripts
    postrotate
        systemctl reload ares > /dev/null 2>&1 || true
    endscript
}

# Test
sudo logrotate -f /etc/logrotate.d/ares
```

---

## Section 5: Disaster Recovery

### 5.1 Scenario: Bot Crashes

**Response Procedure:**
1. [ ] Check if process still running: `ps aux | grep node`
2. [ ] Check recent logs: `tail -50 /var/log/ares/error.log`
3. [ ] Check for orphaned positions on Delta (web UI)
4. [ ] If orphaned position exists:
   - [ ] Manual close via Delta web UI (market order, reduce-only)
   - [ ] Document the issue
   - [ ] Do NOT restart bot until position closed
5. [ ] Restart bot: `systemctl restart ares` or `pm2 restart ares`
6. [ ] Wait 30 seconds, verify WS connected
7. [ ] Monitor logs for normal operation
8. [ ] Check Delta for new position (should show in logs)

### 5.2 Scenario: WS Disconnection Loop

**Symptoms:** Repeated "WS reconnected" logs

**Response:**
1. [ ] Check internet connectivity
2. [ ] Check Delta Exchange status (twitter/status page)
3. [ ] Kill bot: `systemctl stop ares`
4. [ ] Wait 60 seconds
5. [ ] Check for orphaned positions
6. [ ] Restart: `systemctl start ares`
7. [ ] If persists, reboot server

### 5.3 Scenario: Daily Loss Limit Hit

**Symptoms:** `[ARES.KILL] MAX_DAILY_LOSS triggered`

**Response:**
1. [ ] Bot will auto-close all positions (check logs)
2. [ ] Verify all positions closed on Delta
3. [ ] Review yesterday's trades (spreadsheet)
4. [ ] Identify what went wrong
5. [ ] Reduce risk limits for next day
6. [ ] Restart bot when ready
7. [ ] Do NOT resume normal trading until root cause found

### 5.4 Scenario: Orphaned Position (stuck open)

**Symptoms:** Position showing on Delta but not in bot logs

**Response:**
1. [ ] Stop bot immediately: `systemctl stop ares`
2. [ ] Manually close position via Delta:
   - [ ] Go to Positions
   - [ ] Find stuck position
   - [ ] Click "Close Position"
   - [ ] Use market order to ensure fill
3. [ ] Verify closed
4. [ ] Check bot logs for clues
5. [ ] Fix any persistence issues
6. [ ] Restart bot

---

## Section 6: Sign-Off & Approval

### Pre-Live Sign-Off

**Completed by:** [Name]
**Date:** [Date]
**Environment:** Production (Live Trading)

**Checklist Status:**
- [ ] Section 1 (Pre-Deployment): 100% complete
- [ ] Section 2 (First Week): N/A (after 7 days, completion status)
- [ ] Section 3 (Operations): Procedures understood
- [ ] Section 4 (Infrastructure): Deployed and tested
- [ ] Section 5 (Recovery): Procedures understood

**Sign-Off:**
I confirm that ARES has been thoroughly tested and is ready for live trading with real capital.

**Approved By:**
- Primary Operator: _________________________ Date: _______
- Secondary Operator: _________________________ Date: _______
- Risk Officer: _________________________ Date: _______

---

## Section 7: Emergency Contacts

Create a document with:
- [ ] Primary contact number (your phone)
- [ ] Backup contact (colleague)
- [ ] Delta Exchange support
- [ ] Cloud provider support (AWS/GCP/etc., if applicable)
- [ ] Server provider support
- [ ] Internet provider support

---

## Quick Reference Commands

```bash
# Check if running
ps aux | grep node

# View logs (last 100 lines)
tail -100 /var/log/ares/app.log

# Follow logs in real-time
tail -f /var/log/ares/app.log

# Check memory usage
ps aux | grep node | awk '{print $6}' # Memory in KB

# Stop bot
systemctl stop ares
# or
pm2 stop ares

# Start bot
systemctl start ares
# or
pm2 start ares

# Restart bot
systemctl restart ares
# or
pm2 restart ares

# Check account balance
curl -H "Authorization: Bearer $DELTA_API_KEY" https://api.delta.exchange/v2/account

# View server time
curl https://api.delta.exchange/v2/public/time
```

---

**Document Version:** 1.0
**Last Updated:** 2026-03-03
**Maintained By:** ARES Team
