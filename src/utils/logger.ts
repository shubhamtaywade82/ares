import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
        level: "info",
      },
      {
        target: "pino/file",
        options: {
          destination: "logs/trading.log",
          mkdir: true,
        },
        level: "info",
      },
    ],
  },
});

// Helper for standardizing console logs during transition
export const log = {
  info: (msg: string, ...args: any[]) => logger.info(msg, ...args),
  warn: (msg: string, ...args: any[]) => logger.warn(msg, ...args),
  error: (msg: string, ...args: any[]) => logger.error(msg, ...args),
  debug: (msg: string, ...args: any[]) => logger.debug(msg, ...args),
};
