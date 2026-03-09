import { AIClient } from "./ai.client.js";
import { buildAIPrompt } from "./prompt.builder.js";
import { AIVetoInput } from "./ai.types.js";
import { logger } from "../utils/logger.js";

type AIDecision = { decision: "ALLOW" | "BLOCK" | "HOLD" | "CLOSE"; reason: string };

/**
 * Validate that a parsed decision has valid fields
 */
const validateDecision: (d: any) => asserts d is AIDecision = (d: any): asserts d is AIDecision => {
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
 */
const extractJson = (raw: string): AIDecision => {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenceMatch ? fenceMatch[1] ?? "" : raw).trim();

  try {
    const parsed = JSON.parse(candidate);
    validateDecision(parsed);
    return parsed;
  } catch (fenceError) {
    const jsonMatches = raw.match(/\{[^{}]*\}/g);
    if (jsonMatches && jsonMatches.length > 0) {
      const toTry = [...jsonMatches.reverse(), ...jsonMatches];
      for (const jsonStr of toTry) {
        try {
          const parsed = JSON.parse(jsonStr);
          validateDecision(parsed);
          logger.debug(`[ARES.AI] Extracted JSON from fallback: ${jsonStr.slice(0, 50)}...`);
          return parsed;
        } catch {
          continue;
        }
      }
    }
    throw new Error(`No valid JSON found in raw response: ${raw.slice(0, 50)}...`);
  }
}

/**
 * Heuristic fallback for models that ignore JSON formatting.
 */
const heuristicDecision = (raw: string, intent: string): AIDecision => {
  const upper = raw.toUpperCase();
  let decision: "ALLOW" | "BLOCK" | "HOLD" | "CLOSE" =
    intent === "EXIT" ? "HOLD" : "BLOCK";

  if (intent === "EXIT") {
    if (upper.includes("CLOSE") || upper.includes("SELL") || upper.includes("EXIT")) {
      decision = "CLOSE";
    }
  } else {
    if (upper.includes("ALLOW") || upper.includes("YES") || upper.includes("BUY") || upper.includes("CONFLUENCE")) {
      decision = "ALLOW";
    } else if (upper.includes("BLOCK") || upper.includes("NO") || upper.includes("AVOID")) {
      decision = "BLOCK";
    }
  }

  return {
    decision,
    reason: `HEURISTIC: ${raw.slice(0, 50).replace(/\n/g, " ")}...`,
  };
}

export const aiVeto = async (
  client: AIClient,
  input: AIVetoInput
): Promise<{ allowed: boolean; reason: string }> => {
  try {
    const prompt = buildAIPrompt(input);
    const raw = await client.analyze(prompt);

    let parsed: AIDecision;
    try {
      parsed = extractJson(raw);
    } catch (parseError) {
      logger.debug(`[ARES.AI] JSON Extraction failed. Trying heuristic fallback.`);
      parsed = heuristicDecision(raw, input.intent);
    }

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
    logger.error(`[ARES.RISK] AI veto fatal error: ${errorMsg}`);
    return { allowed: false, reason: `AI_FATAL_ERROR: ${errorMsg}` };
  }
}
