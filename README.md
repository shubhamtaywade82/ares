# ARES
Automated Risk-controlled Execution Scalper

## Overview
ARES is a WebSocket-first, rule-based crypto futures scalping engine for Delta Exchange India, built with strict risk controls, deterministic execution, and production-grade safety systems.

## Project Summary
ARES focuses on real-time market ingestion, deterministic strategy scoring, strict risk controls, and automated execution with post-only and SL/TP management.

## What's Included
- Core entrypoint: `src/main.ts`
- Delta integration: `src/delta/`
- Market ingestion: `src/market/`
- Indicators: `src/indicators/`
- Strategy: `src/strategy/`
- Execution: `src/execution/`
- Risk: `src/risk/`
- AI veto layer (optional): `src/ai/`

## Key Features
- Real-time market analysis via WebSocket ticker, orderbook, and trades
- Technical indicators: RSI, EMA, VWAP, ATR
- Multi-factor strategy scoring with risk-reward validation
- Risk controls: daily loss limits, exposure guards, position sizing, kill switch
- Smart execution: post-only orders and automated stop-loss/take-profit
- Graceful shutdown and cleanup

## Documentation
- `README.md` for overview and commands
- `QUICKSTART.md` for setup steps
- `STRATEGIES.md` for configuration examples
- `PROJECT_SUMMARY.md` for architecture and feature summary

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

## Configuration
### API Configuration
- `DELTA_API_KEY`: Your Delta Exchange API key
- `DELTA_API_SECRET`: Your Delta Exchange API secret
- `DELTA_BASE_URL`: API base URL (default: `https://api.india.delta.exchange`)
- `DELTA_WS_URL`: WebSocket URL (default: `wss://socket.india.delta.exchange`)
- `DELTA_PRODUCT_SYMBOL`: Product symbol (e.g., `BTCUSD`)
- `DELTA_PRODUCT_ID`: Optional product id (auto-resolved from symbol if omitted)

### Trading Configuration
- `TRADING_MODE`: `live` or `paper`
- `BOOT_BLOCK_ON_ORPHAN_POSITIONS`: if `true`, triggers kill switch on boot when open live positions are detected
- `BOOT_CLOSE_ORPHAN_POSITIONS`: if `true`, closes unprotected orphaned live positions during exit-state reconciliation on boot
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

### Production Mode (Recommended)
PM2 ensures the bot runs 24/7 and restarts on crash.

```bash
npm run build
npm run start:paper # Start in background (Paper Mode)
npm run start:live  # Start in background (Live Mode)
npm run logs        # View real-time decisions
npm run ui          # Start the web dashboard (Vite dev server)
npm run start:paper:ui  # Start paper bot then open UI in this terminal
npm run monitor     # View CPU/Memory dashboard
npm run stop        # Stop the background process
```


## AI Veto Layer (Optional)
AI is a post-strategy veto only. It must never generate trades, adjust risk, or touch execution.

Flow:
`Market → Indicators → Strategy → Risk → AI Veto → Execution`

Config:
- `AI_PROVIDER` (`ollama` or `openai`, default `ollama`)
- `OLLAMA_URL`, `OLLAMA_MODEL` (e.g., `qwen3:8b`)
- `OPENAI_API_KEY`, `OPENAI_MODEL`

### Senior Prop Desk Trader Persona
The AI follows a **Tiered Confluence Framework**:
1. **Tier 1 (Market Structure)**: Local vs HTF trend alignment.
2. **Tier 2 (Liquidity)**: Proximity to SMC Order Blocks and Fair Value Gaps.
3. **Tier 3 (Precision)**: EMA, VWAP, and RSI momentum.

AI Veto takes both **ENTRY** (`ALLOW`/`BLOCK`) and **EXIT** (`HOLD`/`CLOSE`) intents.


## SMC Liquidity Sweep Guardrails
- Sweep detection runs on closed 15m candles only.
- Active sweeps expire after 8 closed 15m bars (bar-based freshness) and sweep history is capped.
- Sweep confluence is scored only when both conditions hold:
  - sweep reference is within 1.5% of current LTF price
  - sweep candle volume is at least 1.5x recent 20-candle average
- AI veto receives nearest bullish/bearish OB and FVG levels with distance percentages for directional context.
- Nearest OB/FVG lookups are freshness-filtered to avoid stale multi-day zones.
- Bar freshness uses timestamp-derived bar indices (restart-safe).

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
- `trades.ndjson`: one closed-trade record per line (audit/event stream)

## Delta Endpoints
Defaults target Delta Exchange India (production).
Testnet values:
- `DELTA_BASE_URL=https://cdn-ind.testnet.deltaex.org`
- `DELTA_WS_URL=wss://socket-ind.testnet.deltaex.org`

## Safety Notes
- In live mode, ARES reconciles existing live positions and open orders on boot and avoids opening duplicate symbol positions.
- Live mode blocks new entries when a symbol has a pending entry order and reseeds market caches on WebSocket reconnect.
- Pending entries are auto-expired after 15 minutes; stale pending orders are cancelled when order IDs are available.
- Kill switch cleanup now attempts cancel-all-orders and close-all-positions before process exit.
- Order-update path now logs partial fills explicitly for operator review and bracket-sizing verification.
- Live partial fills trigger automatic bracket rebalancing to `filled_qty` for SL/TP order sizes.
- Exit bracket placement now rolls back already-placed orders on partial placement failures to avoid unbalanced protection state.
- Bracket rollback now logs per-order cancel failures so operators can detect and remediate potential orphaned exits quickly.
- Rebalancing is monotonic by fill quantity and aborts when prior bracket cancellations fail, preventing duplicate exit brackets.
- Full-fill updates force a final rebalance attempt so SL/TP size catches up to final `filled_qty` after transient partial-fill failures.
- Reduce-only open orders are ignored during boot pending-entry reconciliation (they are exits, not new entries).
- If `DELTA_PRODUCT_ID` is configured, boot now verifies it against Delta metadata for each symbol and halts on mismatch.
- Paper-mode risk uses an IST-midnight-reset daily PnL baseline so `MAX_DAILY_LOSS` applies per Indian calendar day instead of lifetime session PnL.
- Raw order/position WS payloads are emitted at `debug` level with `[ARES.WS.RAW]` for testnet schema verification.
- Crypto trading carries significant risk. Never trade with more than you can afford to lose.
- Always test on testnet or paper mode before live funds.
- Keep API keys secure and restrict permissions to trading only.

## Development
- `npm run dev`: Run in watch mode
- `npm run lint`: Type-check only (`tsc --noEmit`)
- `npm run build`: Compile to `dist/`
- `npm run start`: Run compiled output
- `npm run clean`: Remove `dist/`

## Testing
- Runner: Node built-in test runner (`node --test`) on compiled files
- Location: `src/**/*.test.ts`
- Run: `npm test`

## License
MIT License. See `LICENSE`.

## Disclaimer
This software is for educational purposes only. Use at your own risk. The authors are not responsible for any financial losses incurred while using this bot.
