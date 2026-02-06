import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  DELTA_API_KEY: z.string().min(10),
  DELTA_API_SECRET: z.string().min(20),
  DELTA_BASE_URL: z.string().url().default("https://api.delta.exchange"),
  DELTA_WS_URL: z.string().url().default("wss://socket.delta.exchange"),
  TRADING_MODE: z.enum(["paper", "live"]),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const env = EnvSchema.parse(process.env);
