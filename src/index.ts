import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import promotionRouter from "./routes/promotion.route";
import couponRouter from "./routes/coupon.route";
import giftCardRouter from "./routes/giftcard.route";
import walletRouter from "./routes/wallet.route";
import analyticsRouter from "./routes/analytics.route";

const app = express();

app.use(
  cors({
    origin: ["http://localhost:3002", "http://localhost:3003"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Health check
app.get("/health", (req: Request, res: Response) => {
  return res.status(200).json({
    status: "ok",
    service: "promotions-service",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
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
    });
  } catch (error) {
    console.error("Failed to start promotions service:", error);
    process.exit(1);
  }
};

start();

export default app;
