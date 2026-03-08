import "dotenv/config";
import { createAIClientFromEnv } from "./ai.client.js";

const benchmark = async () => {
  const client = createAIClientFromEnv();

  // Best picks from available models
  const models = ["qwen2.5:0.5b", "qwen3:0.6b", "llama3.2:latest"];
  const sizes = [1000, 2000, 4000, 8000];

  console.log("--- AI Targeted Model Benchmark ---");
  console.log("-----------------------------------");

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
        await client.analyze(prompt, 90000);
        const duration = Date.now() - start;
        console.log(`  Size: ${size.toString().padStart(5)} chars | Latency: ${(duration / 1000).toFixed(2)}s`);
      } catch (error: any) {
        console.error(`  Size: ${size.toString().padStart(5)} chars | FAILED: ${error.message}`);
      }
    }
  }
}

benchmark().catch(console.error);
