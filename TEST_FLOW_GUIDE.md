# ARES Test Flow Mode

This mode is designed for senior developers and traders to verify the **complete end-to-end trading pipeline** in under 5 minutes.

## What it does
1.  **Relaxes all gates**: Skips HTF bias, SMC score, and AI veto requirements.
2.  **Forces Entry**: If no natural signal is found, it creates a synthetic displacement to trigger an immediate entry on the first available tick (requires only 2 candles).
3.  **Tight Targets**: Overrides strategy targets with a **0.05%** TP/SL distance to ensure the trade closes quickly.
4.  **Auto-Termination**: Monitors the position lifecycle and **automatically exits the process** with a PnL summary once the position is closed.

## How to run

```bash
# Verify ETHUSD flow
TRADING_MODE=test_flow DELTA_PRODUCT_SYMBOL=ETHUSD PAPER_BALANCE=10000 npm start

# Verify BTCUSD flow
TRADING_MODE=test_flow DELTA_PRODUCT_SYMBOL=BTCUSD PAPER_BALANCE=10000 npm start
```

## Expected Output
1.  `[ARES.BOOT] System ready; transitioning to RUNNING`
2.  `[ARES.TEST] TEST_FLOW mode active — will force immediate entry and tight exit...`
3.  `[ARES.TEST] Synthetic displacement for ETHUSD (bias=LONG) — exercising full pipeline`
4.  `[ARES.TEST] Forcing tight targets: Entry:2500.00 SL:2498.75 TP:2501.25`
5.  `[ARES.PAPER] Entry submitted`
6.  `[ARES.PAPER] Entry filled`
7.  `[ARES.PAPER] Bracket orders submitted`
8.  ... wait for price to hit SL or TP ...
9.  `TEST FLOW COMPLETED SUCCESSFULLY`
10. `Final Realized PnL: ₹...`
