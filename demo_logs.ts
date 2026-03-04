import { logger } from "./src/utils/logger.js";

const sampleEntry = { intent: "ENTRY", symbol: "XRPUSD", decision: "ALLOW", reason: "Price is above VWAP and RSI is neutral, confirming bullish trend." };
const sampleExit = { intent: "EXIT", symbol: "XRPUSD", decision: "CLOSE", reason: "5m structure broken to the downside with increasing volume." };

logger.info(`[ARES.RISK] AI ${sampleEntry.intent} ✅ ${sampleEntry.decision} for ${sampleEntry.symbol}: ${sampleEntry.reason}`);
logger.warn(`[ARES.RISK] AI ${sampleExit.intent} ❌ ${sampleExit.decision} for ${sampleExit.symbol}: ${sampleExit.reason}`);
