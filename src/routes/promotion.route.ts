import { Router } from "express";
import { getPromotionsPrisma, Prisma } from "@innovabound-ecomm-platform/promotions-db";
import { requireAuth, requirePermission, AuthenticatedRequest } from "../middleware/auth";
import { createPromotionSchema, updatePromotionSchema, createConditionSchema } from "../schemas/promotion.schema";
import { getSiteId, requireSiteId, promotionWhere, withSiteId } from "../utils/tenant.utils";

const router: Router = Router();
const prisma = getPromotionsPrisma();

// ============================================
// PUBLIC ROUTES
// ============================================

/**
 * @openapi
 * /promotions/active:
 *   get:
 *     summary: Get active promotions
 *     description: Retrieve currently active auto-apply promotions
 *     tags:
 *       - Promotions
 *     responses:
 *       200:
 *         description: List of active promotions
 *       500:
 *         description: Server error
 */
router.get("/active", async (req, res) => {
  try {
    const now = new Date();
    const siteId = getSiteId(req);

    const promotions = await prisma.promotion.findMany({
      where: promotionWhere(siteId, {
        status: "ACTIVE",
        autoApply: true,
        startsAt: { lte: now },
        OR: [
          { endsAt: null },
          { endsAt: { gte: now } },
        ],
        deletedAt: null,
      }, { strict: false }),
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
 * @openapi
 * /promotions:
 *   get:
 *     summary: List all promotions
 *     description: Retrieve paginated list of promotions with filtering (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, SCHEDULED, ACTIVE, PAUSED, ENDED, CANCELLED]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [PERCENTAGE_OFF, FIXED_AMOUNT_OFF, FREE_SHIPPING, BUY_X_GET_Y]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in name and description
 *     responses:
 *       200:
 *         description: List of promotions with pagination
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
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

      const siteId = getSiteId(req);

      const additionalWhere: Prisma.PromotionWhereInput = {
        deletedAt: null,
      };

      if (status) {
        additionalWhere.status = status as any;
      }

      if (type) {
        additionalWhere.type = type as any;
      }

      if (search) {
        additionalWhere.OR = [
          { name: { contains: search as string, mode: "insensitive" } },
          { description: { contains: search as string, mode: "insensitive" } },
        ];
      }

      const where = promotionWhere(siteId, additionalWhere);

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
 * @openapi
 * /promotions/{id}:
 *   get:
 *     summary: Get promotion by ID
 *     description: Retrieve detailed information about a specific promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Promotion ID or UUID
 *     responses:
 *       200:
 *         description: Promotion details
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       404:
 *         description: Promotion not found
 *       500:
 *         description: Server error
 */
router.get(
  "/:id",
  requireAuth,
  requirePermission("promotions:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const siteId = getSiteId(req);

      const promotion = await prisma.promotion.findFirst({
        where: promotionWhere(siteId, {
          OR: [
            { id: parseInt(id, 10) || 0 },
            { uuid: id },
          ],
          deletedAt: null,
        }),
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
 * @openapi
 * /promotions:
 *   post:
 *     summary: Create promotion
 *     description: Create a new promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *               - startsAt
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [PERCENTAGE_OFF, FIXED_AMOUNT_OFF, FREE_SHIPPING, BUY_X_GET_Y]
 *               discountValue:
 *                 type: integer
 *               discountPercent:
 *                 type: integer
 *               startsAt:
 *                 type: string
 *                 format: date-time
 *               endsAt:
 *                 type: string
 *                 format: date-time
 *               autoApply:
 *                 type: boolean
 *               stackable:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Promotion created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
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
      const siteId = requireSiteId(req);

      const promotion = await prisma.promotion.create({
        data: withSiteId({
          ...data,
          startsAt: new Date(startsAt),
          endsAt: endsAt ? new Date(endsAt) : null,
          createdBy: adminId,
        }, siteId),
      });

      return res.status(201).json(promotion);
    } catch (error) {
      console.error("Error creating promotion:", error);
      return res.status(500).json({ error: "Failed to create promotion" });
    }
  }
);

/**
 * @openapi
 * /promotions/{id}:
 *   put:
 *     summary: Update promotion
 *     description: Update an existing promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Promotion updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
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
      const siteId = requireSiteId(req);

      const promotion = await prisma.promotion.update({
        where: { id: parseInt(id, 10), siteId },
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
 * @openapi
 * /promotions/{id}:
 *   delete:
 *     summary: Delete promotion
 *     description: Soft delete a promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Promotion deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
 */
router.delete(
  "/:id",
  requireAuth,
  requirePermission("promotions:delete"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const siteId = requireSiteId(req);

      await prisma.promotion.update({
        where: { id: parseInt(id, 10), siteId },
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
 * @openapi
 * /promotions/{id}/publish:
 *   post:
 *     summary: Publish promotion
 *     description: Activate and publish a promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Promotion published
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
 */
router.post(
  "/:id/publish",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;
      const siteId = requireSiteId(req);

      const promotion = await prisma.promotion.update({
        where: { id: parseInt(id, 10), siteId },
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
 * @openapi
 * /promotions/{id}/pause:
 *   post:
 *     summary: Pause promotion
 *     description: Temporarily pause an active promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Promotion paused
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
 */
router.post(
  "/:id/pause",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;
      const siteId = requireSiteId(req);

      const promotion = await prisma.promotion.update({
        where: { id: parseInt(id, 10), siteId },
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
 * @openapi
 * /promotions/{id}/schedule:
 *   post:
 *     summary: Schedule promotion
 *     description: Set promotion to scheduled status (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Promotion scheduled
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
 */
router.post(
  "/:id/schedule",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;
      const siteId = requireSiteId(req);

      const promotion = await prisma.promotion.update({
        where: { id: parseInt(id, 10), siteId },
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
 * @openapi
 * /promotions/{id}/conditions:
 *   post:
 *     summary: Add promotion condition
 *     description: Add a conditional rule to a promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Condition created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
 */
router.post(
  "/:id/conditions",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;
      const siteId = requireSiteId(req);
      const validation = createConditionSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
      }

      // Verify promotion belongs to tenant
      const promotion = await prisma.promotion.findFirst({
        where: { id: parseInt(id, 10), siteId },
      });
      if (!promotion) {
        return res.status(404).json({ error: "Promotion not found" });
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
 * @openapi
 * /promotions/{id}/conditions/{conditionId}:
 *   delete:
 *     summary: Remove promotion condition
 *     description: Delete a condition from a promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: conditionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Condition deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
 */
router.delete(
  "/:id/conditions/:conditionId",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const conditionId = req.params.conditionId!;
      const siteId = requireSiteId(req);

      // Verify promotion belongs to tenant
      const promotion = await prisma.promotion.findFirst({
        where: { id: parseInt(id, 10), siteId },
      });
      if (!promotion) {
        return res.status(404).json({ error: "Promotion not found" });
      }

      await prisma.promotionCondition.delete({
        where: { id: parseInt(conditionId, 10), promotionId: parseInt(id, 10) },
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
 * @openapi
 * /promotions/{id}/targeting:
 *   get:
 *     summary: Get promotion targeting rules
 *     description: Retrieve targeting rules for a promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Targeting rules
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
 */
router.get(
  "/:id/targeting",
  requireAuth,
  requirePermission("promotions:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const siteId = requireSiteId(req);

      // Verify promotion belongs to tenant
      const promotion = await prisma.promotion.findFirst({
        where: { id: parseInt(id, 10), siteId },
      });
      if (!promotion) {
        return res.status(404).json({ error: "Promotion not found" });
      }

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
 * @openapi
 * /promotions/{id}/targeting:
 *   post:
 *     summary: Add targeting rule
 *     description: Add a targeting rule to a promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - targetType
 *               - targetId
 *             properties:
 *               targetType:
 *                 type: string
 *               targetId:
 *                 type: string
 *               isExclusion:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       201:
 *         description: Targeting rule created
 *       400:
 *         description: Validation error or duplicate rule
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
 */
router.post(
  "/:id/targeting",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;
      const siteId = requireSiteId(req);
      const { targetType, targetId, isExclusion = false } = req.body;

      if (!targetType || !targetId) {
        return res.status(400).json({ error: "targetType and targetId are required" });
      }

      // Verify promotion belongs to tenant
      const promotion = await prisma.promotion.findFirst({
        where: { id: parseInt(id, 10), siteId },
      });
      if (!promotion) {
        return res.status(404).json({ error: "Promotion not found" });
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
 * @openapi
 * /promotions/{id}/targeting/bulk:
 *   post:
 *     summary: Add multiple targeting rules
 *     description: Bulk add targeting rules to a promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - rules
 *             properties:
 *               rules:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     targetType:
 *                       type: string
 *                     targetId:
 *                       type: string
 *                     isExclusion:
 *                       type: boolean
 *     responses:
 *       201:
 *         description: Targeting rules created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
 */
router.post(
  "/:id/targeting/bulk",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;
      const siteId = requireSiteId(req);
      const { rules } = req.body;

      if (!Array.isArray(rules) || rules.length === 0) {
        return res.status(400).json({ error: "rules array is required" });
      }

      // Verify promotion belongs to tenant
      const promotion = await prisma.promotion.findFirst({
        where: { id: parseInt(id, 10), siteId },
      });
      if (!promotion) {
        return res.status(404).json({ error: "Promotion not found" });
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
 * @openapi
 * /promotions/{id}/targeting/{targetingId}:
 *   delete:
 *     summary: Remove targeting rule
 *     description: Delete a specific targeting rule (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: targetingId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Targeting rule deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
 */
router.delete(
  "/:id/targeting/:targetingId",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const targetingId = req.params.targetingId!;
      const siteId = requireSiteId(req);

      // Verify promotion belongs to tenant
      const promotion = await prisma.promotion.findFirst({
        where: { id: parseInt(id, 10), siteId },
      });
      if (!promotion) {
        return res.status(404).json({ error: "Promotion not found" });
      }

      await prisma.promotionTargeting.delete({
        where: { id: parseInt(targetingId, 10), promotionId: parseInt(id, 10) },
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
 * @openapi
 * /promotions/{id}/targeting:
 *   delete:
 *     summary: Clear all targeting rules
 *     description: Remove all targeting rules from a promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: All targeting rules deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
 */
router.delete(
  "/:id/targeting",
  requireAuth,
  requirePermission("promotions:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const siteId = requireSiteId(req);

      // Verify promotion belongs to tenant
      const promotion = await prisma.promotion.findFirst({
        where: { id: parseInt(id, 10), siteId },
      });
      if (!promotion) {
        return res.status(404).json({ error: "Promotion not found" });
      }

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
 * @openapi
 * /promotions/{id}/usage:
 *   get:
 *     summary: Get promotion usage statistics
 *     description: Retrieve usage stats and history for a promotion (admin)
 *     tags:
 *       - Promotions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Promotion usage statistics
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
 */
router.get(
  "/:id/usage",
  requireAuth,
  requirePermission("promotions:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const siteId = requireSiteId(req);
      const { page = "1", limit = "50" } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 100);

      // Verify promotion belongs to tenant
      const promotion = await prisma.promotion.findFirst({
        where: { id: parseInt(id, 10), siteId },
      });
      if (!promotion) {
        return res.status(404).json({ error: "Promotion not found" });
      }

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
