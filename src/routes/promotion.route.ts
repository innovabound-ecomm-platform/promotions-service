import { Router } from "express";
import { getPromotionsPrisma, Prisma } from "@innovabound-ecomm-platform/promotions-db";
import { requireAuth, requirePermission, AuthenticatedRequest } from "../middleware/auth";
import { createPromotionSchema, updatePromotionSchema, createConditionSchema } from "../schemas/promotion.schema";

const router: Router = Router();
const prisma = getPromotionsPrisma();

// ============================================
// PUBLIC ROUTES
// ============================================

/**
 * GET /promotions/active
 * Get active auto-apply promotions
 */
router.get("/active", async (req, res) => {
  try {
    const now = new Date();

    const promotions = await prisma.promotion.findMany({
      where: {
        status: "ACTIVE",
        autoApply: true,
        startsAt: { lte: now },
        OR: [
          { endsAt: null },
          { endsAt: { gte: now } },
        ],
        deletedAt: null,
      },
      orderBy: { stackingPriority: "desc" },
    });

    return res.status(200).json({ data: promotions });
  } catch (error) {
    console.error("Error fetching active promotions:", error);
    return res.status(500).json({ error: "Failed to fetch promotions" });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

/**
 * GET /promotions
 * List all promotions (admin)
 */
router.get(
  "/",
  requireAuth,
  requirePermission("promotions:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { 
        page = "1", 
        limit = "50",
        status,
        type,
        search,
      } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 100);

      const where: Prisma.PromotionWhereInput = {
        deletedAt: null,
      };

      if (status) {
        where.status = status as any;
      }

      if (type) {
        where.type = type as any;
      }

      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: "insensitive" } },
          { description: { contains: search as string, mode: "insensitive" } },
        ];
      }

      const [promotions, total] = await Promise.all([
        prisma.promotion.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
          include: {
            _count: {
              select: {
                coupons: true,
                usages: true,
              },
            },
          },
        }),
        prisma.promotion.count({ where }),
      ]);

      return res.status(200).json({
        data: promotions.map(p => ({
          ...p,
          couponCount: p._count.coupons,
          usageCount: p._count.usages,
          _count: undefined,
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error("Error fetching promotions:", error);
      return res.status(500).json({ error: "Failed to fetch promotions" });
    }
  }
);

/**
 * GET /promotions/:id
 * Get promotion by ID
 */
router.get(
  "/:id",
  requireAuth,
  requirePermission("promotions:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;

      const promotion = await prisma.promotion.findFirst({
        where: {
          OR: [
            { id: parseInt(id, 10) || 0 },
            { uuid: id },
          ],
          deletedAt: null,
        },
        include: {
          coupons: true,
          conditions: {
            orderBy: [{ groupId: "asc" }, { sortOrder: "asc" }],
          },
          targeting: true,
          _count: {
            select: { usages: true },
          },
        },
      });

      if (!promotion) {
        return res.status(404).json({ error: "Promotion not found" });
      }

      return res.status(200).json({
        ...promotion,
        usageCount: promotion._count.usages,
        _count: undefined,
      });
    } catch (error) {
      console.error("Error fetching promotion:", error);
      return res.status(500).json({ error: "Failed to fetch promotion" });
    }
  }
);

/**
 * POST /promotions
 * Create a new promotion
 */
router.post(
  "/",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const adminId = req.user!.id;
      const validation = createPromotionSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
      }

      const { startsAt, endsAt, ...data } = validation.data;

      const promotion = await prisma.promotion.create({
        data: {
          ...data,
          startsAt: new Date(startsAt),
          endsAt: endsAt ? new Date(endsAt) : null,
          createdBy: adminId,
        },
      });

      return res.status(201).json(promotion);
    } catch (error) {
      console.error("Error creating promotion:", error);
      return res.status(500).json({ error: "Failed to create promotion" });
    }
  }
);

/**
 * PUT /promotions/:id
 * Update a promotion
 */
router.put(
  "/:id",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;
      const validation = updatePromotionSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
      }

      const { startsAt, endsAt, ...data } = validation.data;

      const promotion = await prisma.promotion.update({
        where: { id: parseInt(id, 10) },
        data: {
          ...data,
          ...(startsAt && { startsAt: new Date(startsAt) }),
          ...(endsAt !== undefined && { endsAt: endsAt ? new Date(endsAt) : null }),
          updatedBy: adminId,
        },
      });

      return res.status(200).json(promotion);
    } catch (error) {
      console.error("Error updating promotion:", error);
      return res.status(500).json({ error: "Failed to update promotion" });
    }
  }
);

/**
 * DELETE /promotions/:id
 * Soft delete a promotion
 */
router.delete(
  "/:id",
  requireAuth,
  requirePermission("promotions:delete"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;

      await prisma.promotion.update({
        where: { id: parseInt(id, 10) },
        data: { 
          deletedAt: new Date(),
          status: "CANCELLED",
        },
      });

      return res.status(200).json({ 
        success: true, 
        message: "Promotion deleted" 
      });
    } catch (error) {
      console.error("Error deleting promotion:", error);
      return res.status(500).json({ error: "Failed to delete promotion" });
    }
  }
);

// ============================================
// PROMOTION STATUS MANAGEMENT
// ============================================

/**
 * POST /promotions/:id/publish
 * Publish a promotion
 */
router.post(
  "/:id/publish",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;

      const promotion = await prisma.promotion.update({
        where: { id: parseInt(id, 10) },
        data: {
          status: "ACTIVE",
          publishedAt: new Date(),
          publishedBy: adminId,
          updatedBy: adminId,
        },
      });

      return res.status(200).json(promotion);
    } catch (error) {
      console.error("Error publishing promotion:", error);
      return res.status(500).json({ error: "Failed to publish promotion" });
    }
  }
);

/**
 * POST /promotions/:id/pause
 * Pause a promotion
 */
router.post(
  "/:id/pause",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;

      const promotion = await prisma.promotion.update({
        where: { id: parseInt(id, 10) },
        data: {
          status: "PAUSED",
          updatedBy: adminId,
        },
      });

      return res.status(200).json(promotion);
    } catch (error) {
      console.error("Error pausing promotion:", error);
      return res.status(500).json({ error: "Failed to pause promotion" });
    }
  }
);

/**
 * POST /promotions/:id/schedule
 * Schedule a promotion
 */
router.post(
  "/:id/schedule",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;

      const promotion = await prisma.promotion.update({
        where: { id: parseInt(id, 10) },
        data: {
          status: "SCHEDULED",
          updatedBy: adminId,
        },
      });

      return res.status(200).json(promotion);
    } catch (error) {
      console.error("Error scheduling promotion:", error);
      return res.status(500).json({ error: "Failed to schedule promotion" });
    }
  }
);

// ============================================
// PROMOTION CONDITIONS
// ============================================

/**
 * POST /promotions/:id/conditions
 * Add condition to promotion
 */
router.post(
  "/:id/conditions",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;
      const validation = createConditionSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
      }

      const condition = await prisma.promotionCondition.create({
        data: {
          promotionId: parseInt(id, 10),
          ...validation.data,
          createdBy: adminId,
        },
      });

      return res.status(201).json(condition);
    } catch (error) {
      console.error("Error creating condition:", error);
      return res.status(500).json({ error: "Failed to create condition" });
    }
  }
);

/**
 * DELETE /promotions/:id/conditions/:conditionId
 * Remove condition from promotion
 */
router.delete(
  "/:id/conditions/:conditionId",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const conditionId = req.params.conditionId!;

      await prisma.promotionCondition.delete({
        where: { id: parseInt(conditionId, 10) },
      });

      return res.status(200).json({ 
        success: true, 
        message: "Condition deleted" 
      });
    } catch (error) {
      console.error("Error deleting condition:", error);
      return res.status(500).json({ error: "Failed to delete condition" });
    }
  }
);

// ============================================
// PROMOTION TARGETING
// ============================================

/**
 * GET /promotions/:id/targeting
 * Get promotion targeting rules
 */
router.get(
  "/:id/targeting",
  requireAuth,
  requirePermission("promotions:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;

      const targeting = await prisma.promotionTargeting.findMany({
        where: { promotionId: parseInt(id, 10) },
        orderBy: { targetType: "asc" },
      });

      // Group by type for easier consumption
      const grouped = targeting.reduce((acc, t) => {
        const key = t.isExclusion ? `exclude_${t.targetType}` : t.targetType;
        if (!acc[key]) acc[key] = [];
        acc[key].push(t.targetId);
        return acc;
      }, {} as Record<string, string[]>);

      return res.status(200).json({
        data: targeting,
        grouped,
      });
    } catch (error) {
      console.error("Error fetching targeting:", error);
      return res.status(500).json({ error: "Failed to fetch targeting" });
    }
  }
);

/**
 * POST /promotions/:id/targeting
 * Add targeting rule to promotion
 */
router.post(
  "/:id/targeting",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;
      const { targetType, targetId, isExclusion = false } = req.body;

      if (!targetType || !targetId) {
        return res.status(400).json({ error: "targetType and targetId are required" });
      }

      const targeting = await prisma.promotionTargeting.create({
        data: {
          promotionId: parseInt(id, 10),
          targetType,
          targetId,
          isExclusion,
          createdBy: adminId,
        },
      });

      return res.status(201).json(targeting);
    } catch (error: any) {
      if (error.code === "P2002") {
        return res.status(400).json({ error: "This targeting rule already exists" });
      }
      console.error("Error creating targeting:", error);
      return res.status(500).json({ error: "Failed to create targeting" });
    }
  }
);

/**
 * POST /promotions/:id/targeting/bulk
 * Add multiple targeting rules
 */
router.post(
  "/:id/targeting/bulk",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;
      const { rules } = req.body;

      if (!Array.isArray(rules) || rules.length === 0) {
        return res.status(400).json({ error: "rules array is required" });
      }

      const data = rules.map((rule: any) => ({
        promotionId: parseInt(id, 10),
        targetType: rule.targetType,
        targetId: rule.targetId,
        isExclusion: rule.isExclusion || false,
        createdBy: adminId,
      }));

      const result = await prisma.promotionTargeting.createMany({
        data,
        skipDuplicates: true,
      });

      return res.status(201).json({
        success: true,
        created: result.count,
      });
    } catch (error) {
      console.error("Error creating bulk targeting:", error);
      return res.status(500).json({ error: "Failed to create targeting rules" });
    }
  }
);

/**
 * DELETE /promotions/:id/targeting/:targetingId
 * Remove targeting rule
 */
router.delete(
  "/:id/targeting/:targetingId",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const targetingId = req.params.targetingId!;

      await prisma.promotionTargeting.delete({
        where: { id: parseInt(targetingId, 10) },
      });

      return res.status(200).json({ 
        success: true, 
        message: "Targeting rule deleted" 
      });
    } catch (error) {
      console.error("Error deleting targeting:", error);
      return res.status(500).json({ error: "Failed to delete targeting" });
    }
  }
);

/**
 * DELETE /promotions/:id/targeting
 * Clear all targeting rules for a promotion
 */
router.delete(
  "/:id/targeting",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;

      const result = await prisma.promotionTargeting.deleteMany({
        where: { promotionId: parseInt(id, 10) },
      });

      return res.status(200).json({ 
        success: true, 
        deleted: result.count,
      });
    } catch (error) {
      console.error("Error clearing targeting:", error);
      return res.status(500).json({ error: "Failed to clear targeting" });
    }
  }
);

// ============================================
// PROMOTION USAGE/ANALYTICS
// ============================================

/**
 * GET /promotions/:id/usage
 * Get promotion usage stats
 */
router.get(
  "/:id/usage",
  requireAuth,
  requirePermission("promotions:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const { page = "1", limit = "50" } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 100);

      const [usages, total, stats] = await Promise.all([
        prisma.promotionUsage.findMany({
          where: { promotionId: parseInt(id, 10) },
          orderBy: { appliedAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.promotionUsage.count({
          where: { promotionId: parseInt(id, 10) },
        }),
        prisma.promotionUsage.aggregate({
          where: { promotionId: parseInt(id, 10) },
          _sum: { discountAmount: true },
          _count: { _all: true },
        }),
      ]);

      return res.status(200).json({
        data: usages,
        stats: {
          totalUsages: stats._count._all,
          totalDiscountGiven: stats._sum.discountAmount || 0,
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error("Error fetching promotion usage:", error);
      return res.status(500).json({ error: "Failed to fetch usage" });
    }
  }
);

export default router;
