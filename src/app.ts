import express, { Application, NextFunction, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

import { config } from "./config/index.js";
import { logger } from "./config/logger.js";
import { AppError } from "./common/errors/AppError.js";

import promotionRouter from "./routes/promotion.route.js";
import couponRouter from "./routes/coupon.route.js";
import giftCardRouter from "./routes/giftcard.route.js";
import walletRouter from "./routes/wallet.route.js";
import analyticsRouter from "./routes/analytics.route.js";
import healthRoutes from "./health/health.routes.js";

const app: Application = express();

// OpenAPI/Swagger configuration
const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Promotions Service API",
      version: "1.0.0",
      description: `
The Promotions Service manages all promotional activities for the e-commerce platform.

## Features
- **Coupons & Discount Codes**: Create, validate, and redeem discount codes
- **Promotional Campaigns**: Time-based promotional events with configurable rules
- **Sale Events**: Flash sales, seasonal discounts, and special offers
- **Loyalty Programs**: Customer reward points and tier-based benefits
- **Gift Cards**: Digital gift card management and redemption
- **Wallet System**: Customer promotional wallet and balance management
- **Analytics**: Promotion performance tracking and insights
      `,
      contact: {
        name: "E-Commerce Platform Team",
        email: "support@innovabound.com",
      },
      license: {
        name: "ISC",
        url: "https://opensource.org/licenses/ISC",
      },
    },
    servers: [
      {
        url: `http://localhost:${config.port}`,
        description: "Local development server",
      },
    ],
    tags: [
      {
        name: "Promotions",
        description: "Promotional campaigns and sale events management",
      },
      {
        name: "Coupons",
        description: "Coupon and discount code operations",
      },
      {
        name: "Gift Cards",
        description: "Gift card management and redemption",
      },
      {
        name: "Wallets",
        description: "Customer promotional wallet operations",
      },
      {
        name: "Analytics",
        description: "Promotion analytics and performance metrics",
      },
      {
        name: "Health",
        description: "Service health and status endpoints",
      },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "access_token",
          description: "JWT access token stored in cookie",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT token in Authorization header",
        },
      },
    },
  },
  apis: ["./src/routes/*.ts", "./src/index.ts", "./src/health/*.ts"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Middleware
app.use(
  cors({
    origin: config.cors.origins,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Swagger UI documentation
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Promotions Service API Documentation",
  })
);

// OpenAPI JSON specification
app.get("/api-docs.json", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  return res.send(swaggerSpec);
});

// ReDoc documentation
app.get("/redoc", (req: Request, res: Response) => {
  return res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Promotions Service API - ReDoc</title>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
        <style>body { margin: 0; padding: 0; }</style>
      </head>
      <body>
        <redoc spec-url="/api-docs.json"></redoc>
        <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
      </body>
    </html>
  `);
});

// Health routes
app.use("/health", healthRoutes);

// Routes
app.use("/promotions", promotionRouter);
app.use("/coupons", couponRouter);
app.use("/gift-cards", giftCardRouter);
app.use("/wallets", walletRouter);
app.use("/analytics", analyticsRouter);

// Error handler
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    logger.error("Application error", {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      path: req.path,
    });

    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
  }

  if (err instanceof Error) {
    logger.error("Error", {
      message: err.message,
      stack: err.stack,
      path: req.path,
    });

    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: config.isProduction ? "An unexpected error occurred" : err.message,
      },
    });
  }

  logger.error("Unknown error", { error: err, path: req.path });
  return res.status(500).json({
    success: false,
    error: {
      code: "UNKNOWN_ERROR",
      message: "An unexpected error occurred",
    },
  });
});

export default app;
