import { AIClient } from "./ai.client.js";
import { buildAIPrompt } from "./prompt.builder.js";
import { AIVetoInput } from "./ai.types.js";
import { logger } from "../utils/logger.js";

type AIDecision = { decision: "ALLOW" | "BLOCK" | "HOLD" | "CLOSE"; reason: string };

/**
 * Validate that a parsed decision has valid fields
 */
function validateDecision(d: any): asserts d is AIDecision {
  const validDecisions = ["ALLOW", "BLOCK", "HOLD", "CLOSE"];

  if (!d || typeof d !== "object") {
    throw new Error("Response is not an object");
  }

  if (!validDecisions.includes(d.decision)) {
    throw new Error(`Invalid decision: "${d.decision}". Expected one of: ${validDecisions.join(", ")}`);
  }

  if (typeof d.reason !== "string" || d.reason.trim().length < 3) {
    throw new Error(`Invalid or empty reason: "${d.reason}". Reason must be at least 3 characters.`);
  }
}

/**
 * Extract the first valid JSON object from a string that may be wrapped in
 * markdown code fences (```json ... ```). Many local models ignore "no fences"
 * instructions in the prompt.
 *
 * Strategy:
 * 1. Try to extract from markdown fences
 * 2. Try to parse entire response
 * 3. Fallback: Find last {...} block (usually the final decision)
 */
function extractJson(raw: string): AIDecision {
  // 1. Strip ```json ... ``` or ``` ... ``` fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenceMatch ? fenceMatch[1] ?? "" : raw).trim();

  try {
    const parsed = JSON.parse(candidate);
    validateDecision(parsed);
    return parsed;
  } catch (fenceError) {
    // 2. Fallback: try to find all {...} blocks (non-nested only)
    const jsonMatches = raw.match(/\{[^{}]*\}/g);
    if (jsonMatches && jsonMatches.length > 0) {
      // Try LAST block first (usually the final decision), then first
      const toTry = [...jsonMatches.reverse(), ...jsonMatches];
      for (const jsonStr of toTry) {
        try {
          const parsed = JSON.parse(jsonStr);
          validateDecision(parsed);
          logger.debug(`[ARES.AI] Extracted JSON from fallback attempt: ${jsonStr.slice(0, 80)}`);
          return parsed;
        } catch {
          // Continue to next match
          continue;
        }
      }
    }

    throw new Error(
      `Failed to extract valid AI decision. Raw response: "${raw.slice(0, 150)}"`
    );
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
    if (parsed.decision === "ALLOW" || parsed.decision === "HOLD") {
      logger.info(
        `[ARES.RISK] AI ${input.intent} ✅ ${parsed.decision} for ${input.symbol}: ${parsed.reason}`
      );
      return { allowed: true, reason: parsed.reason };
    }
    logger.warn(
      `[ARES.RISK] AI ${input.intent} ❌ ${parsed.decision} for ${input.symbol}: ${parsed.reason}`
    );
    return { allowed: false, reason: parsed.reason };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(
      `[ARES.RISK] AI veto failed for ${input.intent} on ${input.symbol}: ${errorMsg}`
    );
    logger.debug(`[ARES.RISK] Raw AI response: ${raw.slice(0, 200)}`);
    return { allowed: false, reason: `AI_PARSE_ERROR: ${errorMsg}` };
  }
}
