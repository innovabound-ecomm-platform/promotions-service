import { Router, Request, Response, IRouter } from "express";
import { getPromotionsPrisma } from "@innovabound-ecomm-platform/promotions-db";

const router: IRouter = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Liveness check
 *     description: Basic health check to verify the service is running
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is alive
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
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get("/", (req: Request, res: Response) => {
  return res.json({
    status: "ok",
    service: "promotions-service",
    timestamp: new Date().toISOString(),
  });
});

/**
 * @openapi
 * /health/ready:
 *   get:
 *     summary: Readiness check
 *     description: Checks if the service is ready to accept requests (includes database connectivity)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is ready
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
 *                 checks:
 *                   type: object
 *                   properties:
 *                     database:
 *                       type: string
 *                       example: connected
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       503:
 *         description: Service is not ready
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: error
 *                 service:
 *                   type: string
 *                   example: promotions-service
 *                 checks:
 *                   type: object
 *                   properties:
 *                     database:
 *                       type: string
 *                       example: disconnected
 *                 error:
 *                   type: string
 */
router.get("/ready", async (req: Request, res: Response) => {
  try {
    const prisma = getPromotionsPrisma();
    await prisma.$queryRaw`SELECT 1`;

    return res.json({
      status: "ok",
      service: "promotions-service",
      checks: {
        database: "connected",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      status: "error",
      service: "promotions-service",
      checks: {
        database: "disconnected",
      },
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
