import axios from "axios";

export type AIProvider = "ollama" | "openai";

export interface AIClientOptions {
  provider: AIProvider;
  ollamaUrl?: string | undefined;
  ollamaModel?: string | undefined;
  openaiModel?: string | undefined;
  openaiApiKey?: string | undefined;
}

export class AIClient {
  private provider: AIProvider;
  private ollamaUrl: string;
  private ollamaModel: string;
  private openaiModel: string;
  private openaiApiKey: string | undefined;

  constructor(options: AIClientOptions) {
    this.provider = options.provider;
    this.ollamaUrl = options.ollamaUrl ?? "http://localhost:11434/api/chat";
    this.ollamaModel = options.ollamaModel ?? "llama3.1:8b";
    this.openaiModel = options.openaiModel ?? "gpt-4.1-mini";
    this.openaiApiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY;
  }

  async analyze(prompt: { role: string; content: string }): Promise<string> {
    if (this.provider === "ollama") {
      const res = await axios.post(this.ollamaUrl, {
        model: this.ollamaModel,
        messages: [prompt],
        stream: false,
        format: "json",
        options: { temperature: 0 },
      });
      return res.data.message.content;
    }

    if (!this.openaiApiKey) {
      throw new Error("OPENAI_API_KEY not set");
    }

    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: this.openaiModel,
        messages: [prompt],
        temperature: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${this.openaiApiKey}`,
        },
      }
    );

    return res.data.choices[0].message.content;
  }

  async healthCheck(timeoutMs = 1500): Promise<boolean> {
    try {
      if (this.provider === "ollama") {
        await axios.get("http://localhost:11434/api/version", { timeout: timeoutMs });
        return true;
      }

      if (!this.openaiApiKey) return false;

      await axios.get("https://api.openai.com/v1/models", {
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${this.openaiApiKey}`,
        },
      });

      return true;
    } catch {
      return false;
    }
  }
}

export function createAIClientFromEnv(): AIClient {
  const provider = (process.env.AI_PROVIDER ?? "ollama") as AIProvider;

  return new AIClient({
    provider,
    ollamaUrl: process.env.OLLAMA_URL,
    ollamaModel: process.env.OLLAMA_MODEL,
    openaiModel: process.env.OPENAI_MODEL,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
}
