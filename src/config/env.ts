import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional()
);

const optionalNumber = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().positive().optional()
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  DELTA_API_KEY: z.string().min(10),
  DELTA_API_SECRET: z.string().min(20),
  DELTA_BASE_URL: z
    .string()
    .url()
    .default("https://api.india.delta.exchange"),
  DELTA_WS_URL: z
    .string()
    .url()
    .default("wss://socket.india.delta.exchange"),
  DELTA_PRODUCT_SYMBOL: optionalString,
  DELTA_PRODUCT_ID: optionalNumber,
  TRADING_MODE: z.enum(["paper", "live"]),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  FORCE_HTF_BIAS: z.enum(["LONG", "SHORT", "NONE"]).optional(),
  PAPER_BALANCE: optionalNumber,
  PAPER_BYPASS_SCORE: z
    .preprocess(
      (value) =>
        typeof value === "string" && value.trim() === ""
          ? undefined
          : value,
      z.coerce.boolean().optional()
    )
    .default(false),
});

export const env = EnvSchema.parse(process.env);
