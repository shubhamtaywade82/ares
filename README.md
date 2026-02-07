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
