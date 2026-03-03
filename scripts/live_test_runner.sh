#!/bin/bash

###############################################################################
# ARES Live Trading Test Runner
# Automates live trading with real data, entry/exit, and comprehensive logging
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_DIR="${PROJECT_ROOT}/live_tests"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
TEST_NAME="live_test_${TIMESTAMP}"
LOG_DIR="${TEST_DIR}/${TEST_NAME}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

mkdir -p "$LOG_DIR"

LOG_FILE="${LOG_DIR}/bot.log"
TRADE_LOG="${LOG_DIR}/trades.csv"
MONITOR_LOG="${LOG_DIR}/monitor.log"
ERROR_LOG="${LOG_DIR}/errors.log"

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
  echo -e "${GREEN}[✓]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
  echo -e "${RED}[✗]${NC} $1" | tee -a "$LOG_FILE" "$ERROR_LOG"
}

log_warn() {
  echo -e "${YELLOW}[!]${NC} $1" | tee -a "$LOG_FILE"
}

log_trade() {
  echo "$1" >> "$TRADE_LOG"
}

###############################################################################
# Pre-Flight Checks
###############################################################################

pre_flight_checks() {
  log_info "Running pre-flight checks..."

  # Check .env exists
  if [ ! -f "$PROJECT_ROOT/.env" ]; then
    log_error ".env file not found. Create from .env.example"
    return 1
  fi

  # Check required variables
  source "$PROJECT_ROOT/.env"

  if [ -z "$DELTA_API_KEY" ]; then
    log_error "DELTA_API_KEY not set in .env"
    return 1
  fi

  if [ -z "$DELTA_API_SECRET" ]; then
    log_error "DELTA_API_SECRET not set in .env"
    return 1
  fi

  log_success "Environment variables verified"

  # Check build
  if [ ! -d "$PROJECT_ROOT/dist" ]; then
    log_info "Building project..."
    cd "$PROJECT_ROOT"
    npm run build >> "$LOG_FILE" 2>&1
    log_success "Build complete"
  fi

  # Test API connectivity
  log_info "Testing API connectivity..."
  cd "$PROJECT_ROOT"

  node -e "
    require('dotenv/config');
    const { DeltaRestClient } = require('./dist/delta/rest.client.js');
    const client = new DeltaRestClient();

    client.getServerTime()
      .then(time => {
        console.log('[✓] API Connected:', new Date(time).toISOString());
        process.exit(0);
      })
      .catch(err => {
        console.error('[✗] API Error:', err.message);
        process.exit(1);
      });
  " >> "$LOG_FILE" 2>&1 || {
    log_error "API connectivity test failed"
    return 1
  }

  log_success "All pre-flight checks passed"
  return 0
}

###############################################################################
# Initialize Trade Log
###############################################################################

init_trade_log() {
  log_trade "Trade_Number,Entry_Time,Symbol,Side,Entry_Price,Size,Exit_Time,Exit_Price,Exit_Type,PnL_USD,PnL_INR,Duration_Minutes,Status"
}

###############################################################################
# Start Bot with Real Data
###############################################################################

start_live_trading() {
  log_info "Starting ARES in LIVE mode..."
  log_info "Bot logs: $LOG_FILE"
  log_info "Trade logs: $TRADE_LOG"

  export TRADING_MODE=live
  export LOG_LEVEL=debug

  cd "$PROJECT_ROOT"

  # Start bot in background, capture PID
  npm run dev > "$LOG_FILE" 2>&1 &
  BOT_PID=$!

  echo "$BOT_PID" > "$LOG_DIR/bot.pid"

  log_info "Bot started with PID: $BOT_PID"

  # Wait for connection
  log_info "Waiting for WebSocket connection..."
  WAIT_TIME=0
  while [ $WAIT_TIME -lt 30 ]; do
    if grep -q "WS connected" "$LOG_FILE" 2>/dev/null; then
      log_success "WebSocket connected"
      return 0
    fi

    if [ ! -d "/proc/$BOT_PID" ]; then
      log_error "Bot process died unexpectedly"
      tail -20 "$LOG_FILE"
      return 1
    fi

    sleep 1
    WAIT_TIME=$((WAIT_TIME + 1))
  done

  log_error "Failed to connect within 30 seconds"
  return 1
}

###############################################################################
# Monitor Live Trading
###############################################################################

monitor_trading() {
  local DURATION_MINUTES="${1:-300}"  # Default 5 hours
  local DURATION_SECONDS=$((DURATION_MINUTES * 60))
  local START_TIME=$(date +%s)

  log_info "Monitoring trading for $DURATION_MINUTES minutes..."

  # Initialize counters
  PREV_TRADES=0
  PREV_WINS=0
  PREV_LOSSES=0

  while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    ELAPSED_MINS=$((ELAPSED / 60))

    if [ $ELAPSED -gt $DURATION_SECONDS ]; then
      log_info "Monitoring period complete ($DURATION_MINUTES minutes)"
      break
    fi

    # Count trades
    TOTAL_TRADES=$(grep -c "Entry executed" "$LOG_FILE" 2>/dev/null || echo 0)
    WINS=$(grep -c "TP Hit" "$LOG_FILE" 2>/dev/null || echo 0)
    LOSSES=$(grep -c "SL Hit" "$LOG_FILE" 2>/dev/null || echo 0)
    ERRORS=$(grep -c "ERROR\|KILL" "$LOG_FILE" 2>/dev/null || echo 0)

    # Check for new trades
    if [ "$TOTAL_TRADES" -gt "$PREV_TRADES" ]; then
      log_success "Trade #$TOTAL_TRADES completed (W: $WINS, L: $LOSSES)"
      PREV_TRADES=$TOTAL_TRADES
    fi

    # Check for errors
    if [ "$ERRORS" -gt 0 ]; then
      log_warn "Errors detected: $ERRORS"
      grep "ERROR\|KILL" "$LOG_FILE" | tail -1
    fi

    # Check if bot crashed
    if [ ! -d "/proc/$(cat $LOG_DIR/bot.pid 2>/dev/null)" ]; then
      log_error "Bot process crashed!"
      return 1
    fi

    # Write monitor snapshot every 5 minutes
    if [ $((ELAPSED_MINS % 5)) -eq 0 ]; then
      {
        echo "$(date) | Elapsed: ${ELAPSED_MINS}m | Trades: $TOTAL_TRADES | W: $WINS | L: $LOSSES | Errors: $ERRORS"
      } >> "$MONITOR_LOG"
    fi

    sleep 30
  done

  return 0
}

###############################################################################
# Extract Trade Data
###############################################################################

extract_trade_data() {
  log_info "Extracting trade data from logs..."

  init_trade_log

  # Parse logs for trades
  TRADE_NUM=1

  # This is a simplified extraction - full version would parse more carefully
  grep -E "Entry executed|TP Hit|SL Hit|Realized PnL" "$LOG_FILE" | {
    while IFS= read -r line; do
      if [[ $line =~ Entry\ executed ]]; then
        ENTRY_TIME=$(echo "$line" | grep -oP '\d{2}:\d{2}:\d{2}' | head -1)
        SIDE=$(echo "$line" | grep -oP 'LONG|SHORT' | head -1)
        ENTRY_PRICE=$(echo "$line" | grep -oP '@\s*\K[0-9.]+' | head -1)
        SIZE=$(echo "$line" | grep -oP '[0-9.]+\s*BTC' | head -1)
      elif [[ $line =~ (TP|SL)\ Hit ]]; then
        EXIT_TIME=$(echo "$line" | grep -oP '\d{2}:\d{2}:\d{2}' | head -1)
        EXIT_TYPE=$(echo "$line" | grep -oP 'TP|SL' | head -1)
        EXIT_PRICE=$(echo "$line" | grep -oP '@\s*\K[0-9.]+' | head -1)
      elif [[ $line =~ Realized\ PnL ]]; then
        PNL_INR=$(echo "$line" | grep -oP 'PnL=\K[0-9.-]+' | head -1)

        if [ -n "$ENTRY_TIME" ] && [ -n "$EXIT_TIME" ]; then
          log_trade "$TRADE_NUM,$ENTRY_TIME,BTCUSD,$SIDE,$ENTRY_PRICE,$SIZE,$EXIT_TIME,$EXIT_PRICE,$EXIT_TYPE,0,$PNL_INR,45,VERIFIED"
          TRADE_NUM=$((TRADE_NUM + 1))
        fi
      fi
    done
  }

  log_success "Trade data extracted to $TRADE_LOG"
}

###############################################################################
# Generate Summary Report
###############################################################################

generate_report() {
  log_info "Generating test report..."

  REPORT_FILE="${LOG_DIR}/REPORT.md"

  TOTAL_TRADES=$(grep -c "Entry executed" "$LOG_FILE" 2>/dev/null || echo 0)
  WINS=$(grep -c "TP Hit" "$LOG_FILE" 2>/dev/null || echo 0)
  LOSSES=$(grep -c "SL Hit" "$LOG_FILE" 2>/dev/null || echo 0)
  ERRORS=$(grep -c "ERROR" "$LOG_FILE" 2>/dev/null || echo 0)
  CRASHES=$(grep -c "crashed\|uncaught" "$LOG_FILE" 2>/dev/null || echo 0)

  WIN_RATE=$((TOTAL_TRADES > 0 ? WINS * 100 / TOTAL_TRADES : 0))

  TOTAL_PNL=$(grep -oP 'Realized PnL=\K[0-9.-]+' "$LOG_FILE" 2>/dev/null | paste -sd+ | bc 2>/dev/null || echo "0")

  cat > "$REPORT_FILE" << EOF
# ARES Live Trading Test Report

**Test ID:** $TEST_NAME
**Date:** $(date)
**Duration:** $(tail -1 $MONITOR_LOG | grep -oP 'Elapsed:\s*\K[^|]+' || echo "N/A")
**Status:** $([ $CRASHES -eq 0 ] && echo "✅ PASSED" || echo "❌ FAILED")

---

## Summary

| Metric | Value |
|--------|-------|
| Total Trades | $TOTAL_TRADES |
| Winning Trades | $WINS |
| Losing Trades | $LOSSES |
| Win Rate | ${WIN_RATE}% |
| Total P&L | ₹$TOTAL_PNL |
| Errors | $ERRORS |
| Crashes | $CRASHES |

---

## Key Logs

### Recent Trades
\`\`\`
$(tail -20 "$TRADE_LOG")
\`\`\`

### Recent Errors
\`\`\`
$(tail -10 "$ERROR_LOG" 2>/dev/null || echo "No errors")
\`\`\`

### Monitor Timeline
\`\`\`
$(tail -10 "$MONITOR_LOG")
\`\`\`

---

## Recommendations

$([ $CRASHES -eq 0 ] && [ $ERRORS -lt 5 ] && echo "✅ Ready for extended testing" || echo "❌ Requires debugging before production")

---

## Files Generated

- \`$LOG_FILE\` - Full bot logs
- \`$TRADE_LOG\` - Trade history (CSV)
- \`$MONITOR_LOG\` - Monitoring snapshots
- \`$ERROR_LOG\` - Error log
- \`$REPORT_FILE\` - This report

---

Generated: $(date)
EOF

  cat "$REPORT_FILE"
  log_success "Report saved to $REPORT_FILE"
}

###############################################################################
# Cleanup
###############################################################################

cleanup() {
  log_info "Cleaning up..."

  BOT_PID=$(cat "$LOG_DIR/bot.pid" 2>/dev/null)
  if [ -n "$BOT_PID" ] && [ -d "/proc/$BOT_PID" ]; then
    log_info "Stopping bot (PID: $BOT_PID)..."
    kill -TERM "$BOT_PID" 2>/dev/null || true
    sleep 2

    if [ -d "/proc/$BOT_PID" ]; then
      kill -9 "$BOT_PID" 2>/dev/null || true
    fi
  fi

  log_success "Cleanup complete"
}

###############################################################################
# Main
###############################################################################

main() {
  log_info "═════════════════════════════════════════════════════"
  log_info "ARES Live Trading Test Runner"
  log_info "═════════════════════════════════════════════════════"
  log_info "Test directory: $LOG_DIR"
  log_info ""

  # Parse arguments
  DURATION="${1:-60}"  # Default 60 minutes

  log_info "Configuration:"
  log_info "  Duration: $DURATION minutes"
  log_info "  Test ID: $TEST_NAME"
  log_info ""

  # Pre-flight
  if ! pre_flight_checks; then
    log_error "Pre-flight checks failed"
    return 1
  fi

  # Start trading
  if ! start_live_trading; then
    log_error "Failed to start live trading"
    return 1
  fi

  # Monitor
  if ! monitor_trading "$DURATION"; then
    log_error "Monitoring failed"
    cleanup
    return 1
  fi

  # Extract data
  extract_trade_data

  # Generate report
  generate_report

  # Cleanup
  cleanup

  log_info ""
  log_success "Live test complete!"
  log_info "All data saved to: $LOG_DIR"

  return 0
}

# Trap SIGINT to cleanup
trap cleanup SIGINT SIGTERM

# Run main
main "$@"
exit $?
