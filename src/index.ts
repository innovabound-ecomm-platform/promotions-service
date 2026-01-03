import express, { Application, NextFunction, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import promotionRouter from "./routes/promotion.route";
import couponRouter from "./routes/coupon.route";
import giftCardRouter from "./routes/giftcard.route";
import walletRouter from "./routes/wallet.route";
import analyticsRouter from "./routes/analytics.route";

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
        url: "http://localhost:3012",
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
  apis: ["./src/routes/*.ts", "./src/index.ts"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.use(
  cors({
    origin: ["http://localhost:3002", "http://localhost:3003"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Health check endpoint
 *     description: Returns the current health status of the promotions service
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 service:
 *                   type: string
 *                   example: promotions-service
 *                 uptime:
 *                   type: number
 *                   description: Service uptime in seconds
 *                 timestamp:
 *                   type: number
 *                   description: Current timestamp in milliseconds
 */
app.get("/health", (req: Request, res: Response) => {
  return res.status(200).json({
    status: "ok",
    service: "promotions-service",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// Swagger UI documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "Promotions Service API Documentation",
}));

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

// Routes
app.use("/promotions", promotionRouter);
app.use("/coupons", couponRouter);
app.use("/gift-cards", giftCardRouter);
app.use("/wallets", walletRouter);
app.use("/analytics", analyticsRouter);

// Error handler
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error) {
    console.error("Error:", {
      message: err.message,
      stack: err.stack,
    });

    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: process.env.NODE_ENV === "production"
          ? "An unexpected error occurred"
          : err.message,
      },
    });
  }

  console.error("Unknown error:", err);
  return res.status(500).json({
    success: false,
    error: {
      code: "UNKNOWN_ERROR",
      message: "An unexpected error occurred",
    },
  });
});

const PORT = process.env.PORT || 3012;

const start = async () => {
  try {
    app.listen(PORT, () => {
      console.log(`🚀 Promotions service running on port ${PORT}`);
      console.log(`📚 API Documentation:`);
      console.log(`   - Swagger UI: http://localhost:${PORT}/api-docs`);
      console.log(`   - OpenAPI JSON: http://localhost:${PORT}/api-docs.json`);
      console.log(`   - ReDoc: http://localhost:${PORT}/redoc`);
    });
  } catch (error) {
    console.error("Failed to start promotions service:", error);
    process.exit(1);
  }
};

start();

export default app;
