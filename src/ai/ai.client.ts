import axios from "axios";
import { Ollama } from "ollama";
import { logger } from "../utils/logger.js";

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
  private ollama: Ollama | undefined;
  private ollamaModel: string;
  private openaiModel: string;
  private openaiApiKey: string | undefined;
  private queue: Promise<any> = Promise.resolve();

  constructor(options: AIClientOptions) {
    this.provider = options.provider;

    // Ollama library expects the base host, not the full endpoint
    // e.g. "http://localhost:11434" instead of "http://localhost:11434/api/chat"
    const host = options.ollamaUrl ? options.ollamaUrl.replace("/api/chat", "").replace("/api/generate", "") : "http://localhost:11434";

    if (this.provider === "ollama") {
      this.ollama = new Ollama({ host });
    }

    this.ollamaModel = options.ollamaModel ?? "qwen3:latest";
    this.openaiModel = options.openaiModel ?? "gpt-4.1-mini";
    this.openaiApiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY;
  }

  async analyze(
    prompt: { role: string; content: string },
    timeoutMs = 120_000
  ): Promise<string> {
    // Sequential queue to prevent slamming local LLM
    return new Promise((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        try {
          logger.debug(`[ARES.AI] Processing AI request from queue (timeout: ${timeoutMs}ms)`);
          const result = await this._analyzeInternal(prompt, timeoutMs);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  private async _analyzeInternal(
    prompt: { role: any; content: string },
    timeoutMs: number
  ): Promise<string> {
    if (this.provider === "ollama" && this.ollama) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await this.ollama.chat({
          model: this.ollamaModel,
          messages: [prompt],
          stream: false,
          format: "json",
          options: { temperature: 0 },
        });
        clearTimeout(timeout);
        return response.message.content;
      } catch (error: any) {
        clearTimeout(timeout);
        if (error.name === "AbortError") {
          throw new Error(`Ollama request timed out after ${timeoutMs}ms`);
        }
        throw error;
      }
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
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${this.openaiApiKey}`,
        },
      }
    );

    return res.data.choices[0].message.content;
  }

  async healthCheck(timeoutMs = 1500): Promise<boolean> {
    try {
      if (this.provider === "ollama" && this.ollama) {
        // ollama library doesn't have a direct health check but we can check versions
        await axios.get(`${(this.ollama as any).config.host}/api/version`, { timeout: timeoutMs });
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
