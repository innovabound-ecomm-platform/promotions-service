import { Router } from "express";
import { getPromotionsPrisma, Prisma } from "@innovabound-ecomm-platform/promotions-db";
import { requireAuth, requirePermission, AuthenticatedRequest } from "../middleware/auth";

const router: Router = Router();
const prisma = getPromotionsPrisma();

// ============================================
// PROMOTION USAGE ROUTES
// ============================================

/**
 * GET /analytics/promotions/:promotionId/usages
 * Get usage history for a promotion
 */
router.get(
  "/promotions/:promotionId/usages",
  requireAuth,
  requirePermission("promotions:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const promotionId = req.params.promotionId;
      if (!promotionId) {
        return res.status(400).json({ error: "promotionId is required" });
      }
      
      const { page = "1", limit = "50", startDate, endDate } = req.query;
      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 100);

      const where: Prisma.PromotionUsageWhereInput = {
        promotionId: parseInt(promotionId, 10),
      };

      if (startDate || endDate) {
        where.appliedAt = {};
        if (startDate) {
          (where.appliedAt as Prisma.DateTimeFilter).gte = new Date(startDate as string);
        }
        if (endDate) {
          (where.appliedAt as Prisma.DateTimeFilter).lte = new Date(endDate as string);
        }
      }

      const [usages, total] = await Promise.all([
        prisma.promotionUsage.findMany({
          where,
          orderBy: { appliedAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.promotionUsage.count({ where }),
      ]);

      return res.status(200).json({
        data: usages,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error("Error fetching promotion usages:", error);
      return res.status(500).json({ error: "Failed to fetch promotion usages" });
    }
  }
);

/**
 * GET /analytics/coupons/:couponId/usages
 * Get usage history for a coupon
 */
router.get(
  "/coupons/:couponId/usages",
  requireAuth,
  requirePermission("coupons:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const couponId = req.params.couponId;
      if (!couponId) {
        return res.status(400).json({ error: "couponId is required" });
      }
      
      const { page = "1", limit = "50", startDate, endDate } = req.query;
      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 100);

      const where: Prisma.CouponUsageWhereInput = {
        couponId: parseInt(couponId, 10),
      };

      if (startDate || endDate) {
        where.appliedAt = {};
        if (startDate) {
          (where.appliedAt as Prisma.DateTimeFilter).gte = new Date(startDate as string);
        }
        if (endDate) {
          (where.appliedAt as Prisma.DateTimeFilter).lte = new Date(endDate as string);
        }
      }

      const [usages, total] = await Promise.all([
        prisma.couponUsage.findMany({
          where,
          orderBy: { appliedAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.couponUsage.count({ where }),
      ]);

      return res.status(200).json({
        data: usages,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error("Error fetching coupon usages:", error);
      return res.status(500).json({ error: "Failed to fetch coupon usages" });
    }
  }
);

// ============================================
// UNIFIED REDEMPTION TRACKING
// ============================================

/**
 * GET /analytics/redemptions
 * Get all redemptions (unified view)
 */
router.get(
  "/redemptions",
  requireAuth,
  requirePermission("promotions:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { 
        page = "1", 
        limit = "50", 
        type,
        startDate,
        endDate,
        orderId,
        userId,
      } = req.query;
      
      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 100);

      const where: Prisma.PromotionRedemptionWhereInput = {};

      if (type) {
        where.type = type as any;
      }

      if (orderId) {
        where.orderId = orderId as string;
      }

      if (userId) {
        where.userId = userId as string;
      }

      if (startDate || endDate) {
        where.redeemedAt = {};
        if (startDate) {
          (where.redeemedAt as Prisma.DateTimeFilter).gte = new Date(startDate as string);
        }
        if (endDate) {
          (where.redeemedAt as Prisma.DateTimeFilter).lte = new Date(endDate as string);
        }
      }

      const [redemptions, total] = await Promise.all([
        prisma.promotionRedemption.findMany({
          where,
          orderBy: { redeemedAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.promotionRedemption.count({ where }),
      ]);

      return res.status(200).json({
        data: redemptions,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error("Error fetching redemptions:", error);
      return res.status(500).json({ error: "Failed to fetch redemptions" });
    }
  }
);

/**
 * GET /analytics/redemptions/order/:orderId
 * Get all redemptions for an order
 */
router.get(
  "/redemptions/order/:orderId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const orderId = req.params.orderId;
      if (!orderId) {
        return res.status(400).json({ error: "orderId is required" });
      }

      const redemptions = await prisma.promotionRedemption.findMany({
        where: { orderId },
        orderBy: { redeemedAt: "desc" },
      });

      const totalDiscount = redemptions.reduce((sum, r) => sum + r.discountAmount, 0);

      return res.status(200).json({
        data: redemptions,
        summary: {
          count: redemptions.length,
          totalDiscount,
          byType: redemptions.reduce((acc, r) => {
            acc[r.type] = (acc[r.type] || 0) + r.discountAmount;
            return acc;
          }, {} as Record<string, number>),
        },
      });
    } catch (error) {
      console.error("Error fetching order redemptions:", error);
      return res.status(500).json({ error: "Failed to fetch order redemptions" });
    }
  }
);

// ============================================
// ANALYTICS DASHBOARD
// ============================================

/**
 * GET /analytics/summary
 * Get overall promotions analytics summary
 */
router.get(
  "/summary",
  requireAuth,
  requirePermission("promotions:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { startDate, endDate } = req.query;

      const dateFilter: Prisma.DateTimeFilter | undefined = 
        startDate || endDate ? {} : undefined;
      
      if (dateFilter) {
        if (startDate) dateFilter.gte = new Date(startDate as string);
        if (endDate) dateFilter.lte = new Date(endDate as string);
      }

      const [
        activePromotions,
        totalPromotionUsage,
        totalCouponUsage,
        totalGiftCardRedemptions,
        totalWalletRedemptions,
        promotionDiscountTotal,
        giftCardTotal,
        walletTotal,
      ] = await Promise.all([
        prisma.promotion.count({ where: { status: "ACTIVE", deletedAt: null } }),
        prisma.promotionUsage.count({
          where: dateFilter ? { appliedAt: dateFilter } : undefined,
        }),
        prisma.couponUsage.count({
          where: dateFilter ? { appliedAt: dateFilter } : undefined,
        }),
        prisma.promotionRedemption.count({
          where: { 
            type: "GIFT_CARD",
            ...(dateFilter ? { redeemedAt: dateFilter } : {}),
          },
        }),
        prisma.promotionRedemption.count({
          where: { 
            type: "WALLET",
            ...(dateFilter ? { redeemedAt: dateFilter } : {}),
          },
        }),
        prisma.promotionUsage.aggregate({
          where: dateFilter ? { appliedAt: dateFilter } : undefined,
          _sum: { discountAmount: true },
        }),
        prisma.promotionRedemption.aggregate({
          where: { 
            type: "GIFT_CARD",
            ...(dateFilter ? { redeemedAt: dateFilter } : {}),
          },
          _sum: { discountAmount: true },
        }),
        prisma.promotionRedemption.aggregate({
          where: { 
            type: "WALLET",
            ...(dateFilter ? { redeemedAt: dateFilter } : {}),
          },
          _sum: { discountAmount: true },
        }),
      ]);

      return res.status(200).json({
        summary: {
          activePromotions,
          usage: {
            promotions: totalPromotionUsage,
            coupons: totalCouponUsage,
            giftCards: totalGiftCardRedemptions,
            wallet: totalWalletRedemptions,
          },
          discounts: {
            promotions: promotionDiscountTotal._sum.discountAmount || 0,
            giftCards: giftCardTotal._sum.discountAmount || 0,
            wallet: walletTotal._sum.discountAmount || 0,
            total: (promotionDiscountTotal._sum.discountAmount || 0) + 
                   (giftCardTotal._sum.discountAmount || 0) + 
                   (walletTotal._sum.discountAmount || 0),
          },
        },
      });
    } catch (error) {
      console.error("Error fetching analytics summary:", error);
      return res.status(500).json({ error: "Failed to fetch analytics summary" });
    }
  }
);

/**
 * GET /analytics/top-promotions
 * Get top performing promotions
 */
router.get(
  "/top-promotions",
  requireAuth,
  requirePermission("promotions:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { limit = "10", startDate, endDate } = req.query;
      const limitNum = Math.min(parseInt(limit as string, 10), 50);

      const dateFilter: Prisma.DateTimeFilter | undefined = 
        startDate || endDate ? {} : undefined;
      
      if (dateFilter) {
        if (startDate) dateFilter.gte = new Date(startDate as string);
        if (endDate) dateFilter.lte = new Date(endDate as string);
      }

      // Get promotions with usage counts
      const promotions = await prisma.promotion.findMany({
        where: { deletedAt: null },
        include: {
          _count: {
            select: { usages: true },
          },
          usages: {
            where: dateFilter ? { appliedAt: dateFilter } : undefined,
            select: { discountAmount: true },
          },
        },
        orderBy: { currentUsageCount: "desc" },
        take: limitNum,
      });

      const topPromotions = promotions.map(p => ({
        id: p.uuid,
        name: p.name,
        type: p.type,
        status: p.status,
        usageCount: p._count.usages,
        totalDiscount: p.usages.reduce((sum, u) => sum + u.discountAmount, 0),
      }));

      return res.status(200).json({ data: topPromotions });
    } catch (error) {
      console.error("Error fetching top promotions:", error);
      return res.status(500).json({ error: "Failed to fetch top promotions" });
    }
  }
);

/**
 * GET /analytics/top-coupons
 * Get top performing coupons
 */
router.get(
  "/top-coupons",
  requireAuth,
  requirePermission("coupons:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { limit = "10" } = req.query;
      const limitNum = Math.min(parseInt(limit as string, 10), 50);

      const coupons = await prisma.coupon.findMany({
        include: {
          promotion: {
            select: { name: true },
          },
          _count: {
            select: { usages: true },
          },
          usages: {
            select: { discountAmount: true },
          },
        },
        orderBy: { currentUsageCount: "desc" },
        take: limitNum,
      });

      const topCoupons = coupons.map(c => ({
        code: c.code,
        promotionName: c.promotion.name,
        usageCount: c._count.usages,
        totalDiscount: c.usages.reduce((sum, u) => sum + u.discountAmount, 0),
        isActive: c.isActive,
      }));

      return res.status(200).json({ data: topCoupons });
    } catch (error) {
      console.error("Error fetching top coupons:", error);
      return res.status(500).json({ error: "Failed to fetch top coupons" });
    }
  }
);

export default router;
