import app from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./config/logger.js";

async function main() {
  const server = app.listen(config.port, () => {
    logger.info(`🚀 Promotions service running on port ${config.port}`);
    logger.info(`📚 API Documentation:`);
    logger.info(`   - Swagger UI: http://localhost:${config.port}/api-docs`);
    logger.info(`   - OpenAPI JSON: http://localhost:${config.port}/api-docs.json`);
    logger.info(`   - ReDoc: http://localhost:${config.port}/redoc`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    server.close(() => {
      logger.info("HTTP server closed");
    });

    // Close Kafka connections if applicable
    try {
      // Kafka disconnect would go here if using kafka-client
      logger.info("Cleanup completed");
    } catch (error) {
      logger.error("Error during cleanup", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  logger.error("Failed to start promotions service", {
    error: error instanceof Error ? error.message : "Unknown error",
  });
  process.exit(1);
});
