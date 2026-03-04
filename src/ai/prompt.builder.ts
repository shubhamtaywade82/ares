import { AIVetoInput } from "./ai.types.js";

export function buildAIPrompt(input: AIVetoInput) {
  return {
    role: "user",
    content: `You are a professional crypto futures risk analyst.
Your task is to provide a technical decision:
- For ENTRY: Decide whether to ALLOW or BLOCK a new trade.
- For EXIT: Decide whether to HOLD or CLOSE an active position.

Respond strictly based ONLY on the provided deterministic market data.

Rules:
- You MUST prioritize raw indicator values (Price, EMA, RSI, VWAP) over general sentiment.
- You cannot change entry, stop, target, or size.
- You cannot suggest new trades.
- You must respond with valid JSON only.
- If the trade setup is low quality or contradicts market context, choose BLOCK.
- Use SMC freshness fields explicitly:
  - activeSweepAgeMinutes
  - activeSweepVolumeRatio
  - nearest zone distPct
  - nearest zone isInside

Respond format:
{
  "decision": "ALLOW" | "BLOCK",
  "reason": "string"
}

Trade Context:
${JSON.stringify(input, null, 2)}
Return ONLY the JSON object. No explanations. No markdown. No code fences.`,
  };
}
