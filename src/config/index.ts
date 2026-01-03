import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3012),

  // Database
  DATABASE_URL: z.string().url(),

  // Auth service
  AUTH_SERVICE_URL: z.string().url().default("http://localhost:8003"),

  // Kafka (optional)
  KAFKA_BROKERS: z.string().default("localhost:9092"),
  KAFKA_CLIENT_ID: z.string().default("promotions-service"),

  // CORS origins
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:3002,http://localhost:3003"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables:",
    JSON.stringify(parsed.error.format(), null, 2)
  );
  process.exit(1);
}

export const config = {
  env: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  database: {
    url: parsed.data.DATABASE_URL,
  },
  auth: {
    serviceUrl: parsed.data.AUTH_SERVICE_URL,
  },
  kafka: {
    brokers: parsed.data.KAFKA_BROKERS.split(","),
    clientId: parsed.data.KAFKA_CLIENT_ID,
  },
  cors: {
    origins: parsed.data.CORS_ORIGINS.split(","),
  },
  isProduction: parsed.data.NODE_ENV === "production",
  isDevelopment: parsed.data.NODE_ENV === "development",
} as const;

export type Config = typeof config;
