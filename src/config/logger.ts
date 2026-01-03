import { config } from "./index.js";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = config.isProduction ? "info" : "debug";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(
  level: LogLevel,
  message: string,
  context?: LogContext
): string {
  const timestamp = new Date().toISOString();
  const baseLog = {
    timestamp,
    level,
    service: "promotions-service",
    message,
    ...context,
  };

  if (config.isProduction) {
    return JSON.stringify(baseLog);
  }

  const contextStr = context ? ` ${JSON.stringify(context)}` : "";
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`;
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    if (shouldLog("debug")) {
      console.debug(formatMessage("debug", message, context));
    }
  },

  info(message: string, context?: LogContext): void {
    if (shouldLog("info")) {
      console.info(formatMessage("info", message, context));
    }
  },

  warn(message: string, context?: LogContext): void {
    if (shouldLog("warn")) {
      console.warn(formatMessage("warn", message, context));
    }
  },

  error(message: string, context?: LogContext): void {
    if (shouldLog("error")) {
      console.error(formatMessage("error", message, context));
    }
  },
};
