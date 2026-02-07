import { AIClient } from "./ai.client.js";
import { buildAIPrompt } from "./prompt.builder.js";
import { AIVetoInput } from "./ai.types.js";

type AIDecision = { decision: "ALLOW" | "BLOCK"; reason: string };

export async function aiVeto(
  client: AIClient,
  input: AIVetoInput
): Promise<{ allowed: boolean; reason: string }> {
  const prompt = buildAIPrompt(input);
  const raw = await client.analyze(prompt);

  try {
    const parsed = JSON.parse(raw) as AIDecision;
    if (parsed.decision === "ALLOW") {
      console.info(`[ARES.RISK] AI veto allow: ${parsed.reason}`);
      return { allowed: true, reason: parsed.reason };
    }
    console.warn(`[ARES.RISK] AI veto block: ${parsed.reason}`);
    return { allowed: false, reason: parsed.reason };
  } catch {
    console.warn("[ARES.RISK] AI veto block: AI_RESPONSE_INVALID");
    return { allowed: false, reason: "AI_RESPONSE_INVALID" };
  }
}
