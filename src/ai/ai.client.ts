import axios from "axios";

export type AIProvider = "ollama" | "openai";

export interface AIClientOptions {
  provider: AIProvider;
  ollamaUrl?: string;
  ollamaModel?: string;
  openaiModel?: string;
  openaiApiKey?: string;
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
    this.ollamaModel = options.ollamaModel ?? "llama3";
    this.openaiModel = options.openaiModel ?? "gpt-4.1-mini";
    this.openaiApiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY;
  }

  async analyze(prompt: { role: string; content: string }): Promise<string> {
    if (this.provider === "ollama") {
      const res = await axios.post(this.ollamaUrl, {
        model: this.ollamaModel,
        messages: [prompt],
        stream: false,
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
}
