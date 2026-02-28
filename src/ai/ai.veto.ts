import { AIClient } from "./ai.client.js";
import { buildAIPrompt } from "./prompt.builder.js";
import { AIVetoInput } from "./ai.types.js";
import { logger } from "../utils/logger.js";

type AIDecision = { decision: "ALLOW" | "BLOCK"; reason: string };

/**
 * Extract the first valid JSON object from a string that may be wrapped in
 * markdown code fences (```json ... ```). Many local models ignore "no fences"
 * instructions in the prompt.
 */
function extractJson(raw: string): AIDecision {
  // 1. Strip ```json ... ``` or ``` ... ``` fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenceMatch ? fenceMatch[1] ?? "" : raw).trim();

  try {
    return JSON.parse(candidate) as AIDecision;
  } catch {
    // 2. Fallback: grab the first {...} block in the raw text
    const objMatch = raw.match(/\{[\s\S]*?\}/);
    if (objMatch) return JSON.parse(objMatch[0]) as AIDecision;
    throw new Error("No JSON object found in AI response");
  }
}

export async function aiVeto(
  client: AIClient,
  input: AIVetoInput
): Promise<{ allowed: boolean; reason: string }> {
  const prompt = buildAIPrompt(input);
  const raw = await client.analyze(prompt);

  try {
    const parsed = extractJson(raw);
    if (parsed.decision === "ALLOW") {
      logger.info(`[ARES.RISK] AI veto allow: ${parsed.reason}`);
      return { allowed: true, reason: parsed.reason };
    }
    logger.warn(`[ARES.RISK] AI veto block: ${parsed.reason}`);
    return { allowed: false, reason: parsed.reason };
  } catch {
    logger.warn(`[ARES.RISK] AI veto unparseable; raw="${raw.slice(0, 120)}"`);
    return { allowed: false, reason: "AI_RESPONSE_INVALID" };
  }
}
