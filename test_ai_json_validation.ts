import { logger } from "./src/utils/logger.js";

/**
 * Test suite for AI JSON extraction and validation
 * Validates edge cases and error handling
 */

type AIDecision = { decision: "ALLOW" | "BLOCK" | "HOLD" | "CLOSE"; reason: string };

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
          return parsed;
        } catch {
          // Continue to next match
          continue;
        }
      }
    }

    throw new Error(`Failed to extract valid AI decision. Raw response: "${raw.slice(0, 150)}"`);
  }
}

// Test cases
const tests: { name: string; input: string; shouldPass: boolean; expectedDecision?: string }[] = [
  {
    name: "Clean JSON",
    input: `{"decision": "ALLOW", "reason": "RSI oversold below 30"}`,
    shouldPass: true,
    expectedDecision: "ALLOW",
  },
  {
    name: "JSON with markdown fences",
    input: `Here's my analysis:
\`\`\`json
{"decision": "BLOCK", "reason": "Liquidity sweep too old"}
\`\`\``,
    shouldPass: true,
    expectedDecision: "BLOCK",
  },
  {
    name: "Fences without json label",
    input: `Here's my analysis:
\`\`\`
{"decision": "HOLD", "reason": "Position in profit, hold for more"}
\`\`\``,
    shouldPass: true,
    expectedDecision: "HOLD",
  },
  {
    name: "Multiple JSON blocks - uses LAST one",
    input: `First scenario:
{"decision": "ALLOW", "reason": "Bullish"}
But actually:
{"decision": "CLOSE", "reason": "Bearish reversal detected"}`,
    shouldPass: true,
    expectedDecision: "CLOSE",
  },
  {
    name: "Nested JSON objects - extracts valid one",
    input: `Analysis of scenarios:
{
  "bullish": {"decision": "ALLOW", "reason": "Upside"}
}
Final decision:
{"decision": "BLOCK", "reason": "Failed validation"}`,
    shouldPass: true,
    expectedDecision: "BLOCK",
  },
  {
    name: "Empty reason - FAILS",
    input: `{"decision": "ALLOW", "reason": ""}`,
    shouldPass: false,
  },
  {
    name: "Missing reason field - FAILS",
    input: `{"decision": "ALLOW"}`,
    shouldPass: false,
  },
  {
    name: "Invalid decision value - FAILS",
    input: `{"decision": "MAYBE", "reason": "Uncertain"}`,
    shouldPass: false,
  },
  {
    name: "Reason too short - FAILS",
    input: `{"decision": "ALLOW", "reason": "OK"}`,
    shouldPass: false,
  },
  {
    name: "Prose with embedded JSON",
    input: `Based on technical analysis, the current setup shows:
- RSI at 45 (neutral)
- Price above EMA20
- Active sweep is 120 minutes old (stale)

Therefore:
{"decision": "BLOCK", "reason": "Liquidity sweep too old, waiting for fresh setup"}`,
    shouldPass: true,
    expectedDecision: "BLOCK",
  },
  {
    name: "HOLD decision for EXIT intent",
    input: `{"decision": "HOLD", "reason": "Position momentum still strong"}`,
    shouldPass: true,
    expectedDecision: "HOLD",
  },
  {
    name: "CLOSE decision for EXIT intent",
    input: `{"decision": "CLOSE", "reason": "RSI overbought, take profits now"}`,
    shouldPass: true,
    expectedDecision: "CLOSE",
  },
  {
    name: "No JSON found - FAILS",
    input: `The market is looking bullish today`,
    shouldPass: false,
  },
  {
    name: "Malformed JSON - FAILS",
    input: `{"decision": "ALLOW" "reason": "Missing comma"}`,
    shouldPass: false,
  },
];

async function runTests() {
  let passed = 0;
  let failed = 0;

  console.log(`\n🧪 Testing AI JSON Extraction & Validation\n${"=".repeat(60)}\n`);

  for (const test of tests) {
    try {
      const result = extractJson(test.input);
      if (test.shouldPass) {
        if (test.expectedDecision && result.decision !== test.expectedDecision) {
          console.log(`❌ ${test.name}`);
          console.log(`   Expected decision: ${test.expectedDecision}, got: ${result.decision}\n`);
          failed++;
        } else {
          console.log(`✅ ${test.name}`);
          console.log(`   Decision: ${result.decision} | Reason: "${result.reason}"\n`);
          passed++;
        }
      } else {
        console.log(`❌ ${test.name} (should have failed but passed)`);
        console.log(`   Got: ${result.decision} - ${result.reason}\n`);
        failed++;
      }
    } catch (error) {
      if (!test.shouldPass) {
        console.log(`✅ ${test.name} (correctly rejected)`);
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`   Error: ${msg.slice(0, 80)}\n`);
        passed++;
      } else {
        console.log(`❌ ${test.name}`);
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`   Error: ${msg}\n`);
        failed++;
      }
    }
  }

  console.log(`${"=".repeat(60)}\n`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${tests.length} total\n`);

  if (failed === 0) {
    console.log(`🎉 All tests passed!\n`);
  } else {
    console.log(`⚠️  ${failed} test(s) failed\n`);
  }
}

runTests().catch(console.error);
