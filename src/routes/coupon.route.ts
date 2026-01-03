import { Router } from "express";
import { getPromotionsPrisma } from "@innovabound-ecomm-platform/promotions-db";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requirePermission, optionalAuth, AuthenticatedRequest } from "../middleware/auth";
import { createCouponSchema, updateCouponSchema, validateCouponSchema } from "../schemas/promotion.schema";

const router: Router = Router();
const prisma = getPromotionsPrisma();

/**
 * Generate a random coupon code
 */
function generateCouponCode(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ============================================
// PUBLIC ROUTES
// ============================================

/**
 * POST /coupons/validate
 * Validate a coupon code
 */
router.post("/validate", optionalAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const validation = validateCouponSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors });
    }

    const { code, cartTotal, cartItems } = validation.data;
    const userId = req.user?.id;
    const now = new Date();

    // Find coupon
    const coupon = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        promotion: true,
      },
    });

    if (!coupon) {
      return res.status(404).json({ 
        valid: false, 
        error: "Coupon not found" 
      });
    }

    // Check if active
    if (!coupon.isActive) {
      return res.status(400).json({ 
        valid: false, 
        error: "Coupon is not active" 
      });
    }

    // Check expiration
    if (coupon.expiresAt && coupon.expiresAt < now) {
      return res.status(400).json({ 
        valid: false, 
        error: "Coupon has expired" 
      });
    }

    // Check promotion status and dates
    const promo = coupon.promotion;
    if (promo.status !== "ACTIVE") {
      return res.status(400).json({ 
        valid: false, 
        error: "Promotion is not active" 
      });
    }

    if (promo.startsAt > now) {
      return res.status(400).json({ 
        valid: false, 
        error: "Promotion has not started yet" 
      });
    }

    if (promo.endsAt && promo.endsAt < now) {
      return res.status(400).json({ 
        valid: false, 
        error: "Promotion has ended" 
      });
    }

    // Check usage limits
    if (coupon.totalUsageLimit && coupon.currentUsageCount >= coupon.totalUsageLimit) {
      return res.status(400).json({ 
        valid: false, 
        error: "Coupon usage limit reached" 
      });
    }

    // Check per-user limit
    if (userId && coupon.perUserLimit) {
      const userUsages = await prisma.couponUsage.count({
        where: { couponId: coupon.id, userId },
      });
      if (userUsages >= coupon.perUserLimit) {
        return res.status(400).json({ 
          valid: false, 
          error: "You have already used this coupon the maximum number of times" 
        });
      }
    }

    // Check first order only
    if (promo.firstOrderOnly && userId) {
      // TODO: Check with order service if user has previous orders
    }

    // Check minimum order amount
    if (promo.minOrderAmount && cartTotal < promo.minOrderAmount) {
      return res.status(400).json({ 
        valid: false, 
        error: `Minimum order amount is ${(promo.minOrderAmount / 100).toFixed(2)}` 
      });
    }

    // Calculate discount
    let discountAmount = 0;
    if (promo.type === "PERCENTAGE_OFF" && promo.discountPercent) {
      discountAmount = Math.floor(cartTotal * promo.discountPercent / 10000);
      if (promo.maxDiscountAmount) {
        discountAmount = Math.min(discountAmount, promo.maxDiscountAmount);
      }
    } else if (promo.type === "FIXED_AMOUNT_OFF") {
      discountAmount = Math.min(promo.discountValue, cartTotal);
    } else if (promo.type === "FREE_SHIPPING") {
      // Discount will be calculated based on shipping cost at checkout
      discountAmount = 0;
    }

    return res.status(200).json({
      valid: true,
      coupon: {
        code: coupon.code,
        promotionName: promo.name,
        type: promo.type,
        discountValue: promo.discountValue,
        discountPercent: promo.discountPercent,
        maxDiscountAmount: promo.maxDiscountAmount,
      },
      discountAmount,
      message: promo.description || `${promo.name} applied!`,
    });
  } catch (error) {
    console.error("Error validating coupon:", error);
    return res.status(500).json({ error: "Failed to validate coupon" });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

/**
 * GET /coupons
 * List all coupons (admin)
 */
router.get(
  "/",
  requireAuth,
  requirePermission("coupons:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { 
        page = "1", 
        limit = "50",
        promotionId,
        isActive,
        search,
      } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 100);

      const where: any = {};

      if (promotionId) {
        where.promotionId = parseInt(promotionId as string, 10);
      }

      if (isActive !== undefined) {
        where.isActive = isActive === "true";
      }

      if (search) {
        where.code = { contains: (search as string).toUpperCase(), mode: "insensitive" };
      }

      const [coupons, total] = await Promise.all([
        prisma.coupon.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
          include: {
            promotion: {
              select: { id: true, name: true, status: true },
            },
            _count: {
              select: { usages: true },
            },
          },
        }),
        prisma.coupon.count({ where }),
      ]);

      return res.status(200).json({
        data: coupons.map(c => ({
          ...c,
          usageCount: c._count.usages,
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
      console.error("Error fetching coupons:", error);
      return res.status(500).json({ error: "Failed to fetch coupons" });
    }
  }
);

/**
 * GET /coupons/:code
 * Get coupon by code (admin)
 */
router.get(
  "/:code",
  requireAuth,
  requirePermission("coupons:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const code = req.params.code!;

      const coupon = await prisma.coupon.findUnique({
        where: { code: code.toUpperCase() },
        include: {
          promotion: true,
          _count: {
            select: { usages: true },
          },
        },
      });

      if (!coupon) {
        return res.status(404).json({ error: "Coupon not found" });
      }

      return res.status(200).json({
        ...coupon,
        usageCount: coupon._count.usages,
        _count: undefined,
      });
    } catch (error) {
      console.error("Error fetching coupon:", error);
      return res.status(500).json({ error: "Failed to fetch coupon" });
    }
  }
);

/**
 * POST /coupons
 * Create a new coupon
 */
router.post(
  "/",
  requireAuth,
  requirePermission("coupons:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const adminId = req.user!.id;
      const validation = createCouponSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
      }

      const { code, expiresAt, ...data } = validation.data;
      
      // Generate code if not provided
      let couponCode = code || generateCouponCode();
      
      // Ensure unique
      while (await prisma.coupon.findUnique({ where: { code: couponCode } })) {
        couponCode = generateCouponCode();
      }

      const coupon = await prisma.coupon.create({
        data: {
          ...data,
          code: couponCode,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          createdBy: adminId,
        },
        include: {
          promotion: {
            select: { id: true, name: true },
          },
        },
      });

      return res.status(201).json(coupon);
    } catch (error) {
      console.error("Error creating coupon:", error);
      return res.status(500).json({ error: "Failed to create coupon" });
    }
  }
);

/**
 * POST /coupons/bulk
 * Generate multiple coupons
 */
router.post(
  "/bulk",
  requireAuth,
  requirePermission("coupons:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const adminId = req.user!.id;
      const { promotionId, count = 10, prefix = "", ...settings } = req.body;

      if (!promotionId || count < 1 || count > 1000) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const coupons: any[] = [];
      const existingCodes = new Set<string>();

      for (let i = 0; i < count; i++) {
        let code = (prefix + generateCouponCode()).toUpperCase();
        while (existingCodes.has(code)) {
          code = (prefix + generateCouponCode()).toUpperCase();
        }
        existingCodes.add(code);
        
        coupons.push({
          code,
          promotionId,
          ...settings,
          expiresAt: settings.expiresAt ? new Date(settings.expiresAt) : null,
          createdBy: adminId,
        });
      }

      const result = await prisma.coupon.createMany({
        data: coupons,
        skipDuplicates: true,
      });

      return res.status(201).json({
        success: true,
        created: result.count,
        codes: coupons.map(c => c.code),
      });
    } catch (error) {
      console.error("Error creating bulk coupons:", error);
      return res.status(500).json({ error: "Failed to create coupons" });
    }
  }
);

/**
 * PUT /coupons/:code
 * Update a coupon
 */
router.put(
  "/:code",
  requireAuth,
  requirePermission("coupons:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const code = req.params.code!;
      const adminId = req.user!.id;
      const validation = updateCouponSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
      }

      const { expiresAt, ...data } = validation.data;

      const coupon = await prisma.coupon.update({
        where: { code: code.toUpperCase() },
        data: {
          ...data,
          ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
          updatedBy: adminId,
        },
      });

      return res.status(200).json(coupon);
    } catch (error) {
      console.error("Error updating coupon:", error);
      return res.status(500).json({ error: "Failed to update coupon" });
    }
  }
);

/**
 * DELETE /coupons/:code
 * Delete a coupon
 */
router.delete(
  "/:code",
  requireAuth,
  requirePermission("coupons:delete"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const code = req.params.code!;

      await prisma.coupon.delete({
        where: { code: code.toUpperCase() },
      });

      return res.status(200).json({ 
        success: true, 
        message: "Coupon deleted" 
      });
    } catch (error) {
      console.error("Error deleting coupon:", error);
      return res.status(500).json({ error: "Failed to delete coupon" });
    }
  }
);

/**
 * POST /coupons/:code/deactivate
 * Deactivate a coupon
 */
router.post(
  "/:code/deactivate",
  requireAuth,
  requirePermission("coupons:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const code = req.params.code!;
      const adminId = req.user!.id;

      const coupon = await prisma.coupon.update({
        where: { code: code.toUpperCase() },
        data: { 
          isActive: false,
          updatedBy: adminId,
        },
      });

      return res.status(200).json(coupon);
    } catch (error) {
      console.error("Error deactivating coupon:", error);
      return res.status(500).json({ error: "Failed to deactivate coupon" });
    }
  }
);

export default router;
