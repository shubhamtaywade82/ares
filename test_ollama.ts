import { AIClient } from "./src/ai/ai.client.js";

async function main() {
  const client = new AIClient({ provider: "ollama", ollamaModel: "qwen3:latest" });
  
  console.log("Health check...");
  const isHealthy = await client.healthCheck();
  console.log("Is Healthy:", isHealthy);
  
  if (isHealthy) {
     console.log("Querying for analysis on XRPUSD...");
     const response = await client.analyze({ role: "user", content: "Analyze XRPUSD technically." }, 60000); 
     console.log("Analysis Response:\n", response);
  }
}

main().catch(console.error);
