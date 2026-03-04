import "dotenv/config";
import { createAIClientFromEnv } from "./ai.client.js";

async function benchmark() {
  const client = createAIClientFromEnv();

  // We'll test the models the user has available and were fast enough
  const models = ["qwen2.5:0.5b", "llama3.2:1b", "qwen3:0.6b"];
  const sizes = [500, 1000, 2000, 4000];

  console.log("--- AI Multi-Model Benchmark (Ollama Lib) ---");
  console.log("----------------------------------------------");

  for (const model of models) {
    console.log(`\nTesting Model: ${model}`);

    // Temporarily override the model in the client for benchmarking
    (client as any).ollamaModel = model;

    for (const size of sizes) {
      const dummyText = "A".repeat(size);
      const prompt = {
        role: "user" as const,
        content: `Analyze this data and return a JSON object with a 'decision' (ALLOW/BLOCK) and 'reason'. Data: ${dummyText}`
      };

      const start = Date.now();
      try {
        await client.analyze(prompt, 60000);
        const duration = Date.now() - start;
        console.log(`  Size: ${size.toString().padStart(5)} chars | Latency: ${(duration / 1000).toFixed(2)}s`);
      } catch (error: any) {
        console.error(`  Size: ${size.toString().padStart(5)} chars | FAILED: ${error.message}`);
      }
    }
  }
}

benchmark().catch(console.error);
