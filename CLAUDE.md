# ARES

**Automated Risk-controlled Execution Scalper** — WebSocket-first, rule-based crypto futures scalping engine for **Delta Exchange India**. TypeScript/Node.js. Production-grade safety systems.

## Stack

- TypeScript + Node.js >= 18
- `tsx` for dev hot reload
- Delta Exchange WebSocket + REST API
- No external framework dependencies (pure TypeScript)

## Commands

```bash
npm install
cp .env.example .env        # configure API credentials + parameters
npm run dev                  # development (hot reload via tsx watch)
npm run build                # compile TypeScript → dist/
npm start                    # production (runs dist/main.js)
```

## Architecture

```
src/
  main.ts                    # Entry point — wires everything together
  delta/                     # Delta Exchange WebSocket + REST adapter
  market/                    # Real-time ingestion (ticker, orderbook, trades)
  indicators/                # RSI, EMA, VWAP, ATR (pure functions)
  strategy/                  # Multi-factor scoring, signal generation
  execution/                 # Post-only order placement, SL/TP management
  risk/                      # Daily loss limits, exposure guards, position sizing, kill switch
  ai/                        # Optional AI veto layer
  state/                     # In-memory position and trade state
  config/                    # Env-based configuration
  types/                     # Shared TypeScript interfaces
  utils/                     # Shared utilities
```

## Key design decisions

- **Post-only orders only** — never taker orders (reduces slippage + fees)
- **Kill switch is non-negotiable** — `risk/` can halt all trading; never bypass it
- Indicators in `src/indicators/` are **pure functions** — no I/O, no state
- Market data flows: `delta/` → `market/` → `strategy/` → `execution/` — never skip layers
- AI veto (`src/ai/`) is optional and must never block execution if unavailable

## Critical rules

- **Delta Exchange only** — no DhanHQ code, no Indian market instruments (NSE/BSE)
- All credentials via `.env` — `DELTA_API_KEY`, `DELTA_API_SECRET`
- Never write to `src/indicators/` functions that have side effects
- `risk/` daily loss limit and exposure guard run on every trade decision — never skip
- Graceful shutdown hook must clean up open positions and WebSocket connections
- `tsconfig.json` uses strict mode — do not disable `strict`, `noImplicitAny`, or `strictNullChecks`
