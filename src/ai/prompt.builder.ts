import { AIVetoInput } from "./ai.types.js";

export function buildAIPrompt(input: AIVetoInput) {
  return {
    role: "user",
    content: `You are a professional crypto futures risk analyst.
Your task is to decide whether to ALLOW or BLOCK a trade.

Rules:
- You cannot change entry, stop, target, or size
- You cannot suggest new trades
- You must respond with valid JSON only
- If uncertain, choose BLOCK

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
