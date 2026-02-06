# ARES
Automated Risk-controlled Execution Scalper

## Overview
ARES is a WebSocket-first, rule-based crypto futures scalping engine for Delta Exchange India, built with strict risk controls, deterministic execution, and production-grade safety systems.

## Project Director
Nemesis — Project Director / System Architect

Responsibilities:
- Owns strategy logic
- Owns risk rules
- Owns capital protection decisions
- Final authority on live deployment

## Modules & Logging Conventions
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

## AI Veto Layer (Optional)
AI is a post-strategy veto only. It must never generate trades, adjust risk, or touch execution.

Flow:
Market → Indicators → Strategy → Risk → AI Veto → Execution

Files:
- `src/ai/ai.client.ts`
- `src/ai/prompt.builder.ts`
- `src/ai/ai.veto.ts`
- `src/ai/ai.types.ts`

Config:
- `AI_PROVIDER` (`ollama` or `openai`, default `ollama`)
- `OLLAMA_URL`, `OLLAMA_MODEL`
- `OPENAI_API_KEY`, `OPENAI_MODEL`

## Development
- `npm run dev`: Run in watch mode
- `npm run lint`: Type-check only (`tsc --noEmit`)
- `npm run build`: Compile to `dist/`
- `npm run start`: Run compiled output

## Identity Variants
Primary: `ARES`
Optional variants: `ARES-X` (live), `ARES-SIM` (paper/backtest), `ARES-CORE` (engine-only)
