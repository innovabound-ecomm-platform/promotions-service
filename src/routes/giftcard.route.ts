import { Router } from "express";
import { getPromotionsPrisma } from "@innovabound-ecomm-platform/promotions-db";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requirePermission, AuthenticatedRequest } from "../middleware/auth";
import { createGiftCardSchema, redeemGiftCardSchema } from "../schemas/promotion.schema";

const router: Router = Router();
const prisma = getPromotionsPrisma();

/**
 * Generate a gift card code
 */
function generateGiftCardCode(): string {
  const segments = [];
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let s = 0; s < 4; s++) {
    let segment = "";
    for (let i = 0; i < 4; i++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    segments.push(segment);
  }
  return segments.join("-"); // e.g., "ABCD-EFGH-JKLM-NPQR"
}

// ============================================
// PUBLIC ROUTES
// ============================================

/**
 * GET /gift-cards/check/:code
 * Check gift card balance (public)
 */
router.get("/check/:code", async (req, res) => {
  try {
    const { code } = req.params;

    const giftCard = await prisma.giftCard.findUnique({
      where: { code: code.toUpperCase().replace(/\s/g, "") },
      select: {
        uuid: true,
        currentBalance: true,
        currency: true,
        status: true,
        expiresAt: true,
      },
    });

    if (!giftCard) {
      return res.status(404).json({ error: "Gift card not found" });
    }

    if (giftCard.status === "CANCELLED") {
      return res.status(400).json({ error: "Gift card has been cancelled" });
    }

    if (giftCard.status === "EXPIRED" || (giftCard.expiresAt && giftCard.expiresAt < new Date())) {
      return res.status(400).json({ error: "Gift card has expired" });
    }

    return res.status(200).json({
      id: giftCard.uuid,
      balance: giftCard.currentBalance,
      currency: giftCard.currency,
      status: giftCard.status,
    });
  } catch (error) {
    console.error("Error checking gift card:", error);
    return res.status(500).json({ error: "Failed to check gift card" });
  }
});

/**
 * POST /gift-cards/redeem
 * Redeem gift card for order
 */
router.post("/redeem", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const validation = redeemGiftCardSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors });
    }

    const { code, pin, amount, orderId } = validation.data;

    const giftCard = await prisma.giftCard.findUnique({
      where: { code: code.toUpperCase().replace(/\s/g, "") },
    });

    if (!giftCard) {
      return res.status(404).json({ error: "Gift card not found" });
    }

    // Verify PIN if required
    if (giftCard.pin && giftCard.pin !== pin) {
      return res.status(400).json({ error: "Invalid PIN" });
    }

    // Check status
    if (!["ACTIVE", "PARTIALLY_USED"].includes(giftCard.status)) {
      return res.status(400).json({ error: `Gift card is ${giftCard.status.toLowerCase()}` });
    }

    // Check expiration
    if (giftCard.expiresAt && giftCard.expiresAt < new Date()) {
      return res.status(400).json({ error: "Gift card has expired" });
    }

    // Check balance
    if (giftCard.currentBalance < amount) {
      return res.status(400).json({ 
        error: "Insufficient balance",
        availableBalance: giftCard.currentBalance,
      });
    }

    // Deduct balance
    const newBalance = giftCard.currentBalance - amount;
    const newStatus = newBalance === 0 ? "DEPLETED" : "PARTIALLY_USED";

    const [updatedCard, transaction] = await prisma.$transaction([
      prisma.giftCard.update({
        where: { id: giftCard.id },
        data: {
          currentBalance: newBalance,
          status: newStatus,
        },
      }),
      prisma.giftCardTransaction.create({
        data: {
          giftCardId: giftCard.id,
          amount: -amount,
          balanceAfter: newBalance,
          orderId,
          description: `Redeemed for order ${orderId}`,
          performedBy: userId,
          actorUserId: userId,
          actorType: "USER",
          createdBy: userId,
        },
      }),
    ]);

    // Record redemption for analytics
    await prisma.promotionRedemption.create({
      data: {
        type: "GIFT_CARD",
        giftCardId: giftCard.id,
        orderId,
        userId,
        discountAmount: amount,
        currency: giftCard.currency,
        actorUserId: userId,
        actorType: "USER",
        createdBy: userId,
      },
    });

    return res.status(200).json({
      success: true,
      amountRedeemed: amount,
      remainingBalance: newBalance,
      transactionId: transaction.id,
    });
  } catch (error) {
    console.error("Error redeeming gift card:", error);
    return res.status(500).json({ error: "Failed to redeem gift card" });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

/**
 * GET /gift-cards
 * List all gift cards (admin)
 */
router.get(
  "/",
  requireAuth,
  requirePermission("gift-cards:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { 
        page = "1", 
        limit = "50",
        status,
        search,
      } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 100);

      const where: any = {};

      if (status) {
        where.status = status;
      }

      if (search) {
        where.OR = [
          { code: { contains: (search as string).toUpperCase(), mode: "insensitive" } },
          { purchasedForEmail: { contains: search as string, mode: "insensitive" } },
          { recipientName: { contains: search as string, mode: "insensitive" } },
        ];
      }

      const [giftCards, total] = await Promise.all([
        prisma.giftCard.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.giftCard.count({ where }),
      ]);

      return res.status(200).json({
        data: giftCards,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error("Error fetching gift cards:", error);
      return res.status(500).json({ error: "Failed to fetch gift cards" });
    }
  }
);

/**
 * GET /gift-cards/:id
 * Get gift card by ID (admin)
 */
router.get(
  "/:id",
  requireAuth,
  requirePermission("gift-cards:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;

      const giftCard = await prisma.giftCard.findFirst({
        where: {
          OR: [
            { id: parseInt(id, 10) || 0 },
            { uuid: id },
            { code: id.toUpperCase() },
          ],
        },
        include: {
          transactions: {
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!giftCard) {
        return res.status(404).json({ error: "Gift card not found" });
      }

      return res.status(200).json(giftCard);
    } catch (error) {
      console.error("Error fetching gift card:", error);
      return res.status(500).json({ error: "Failed to fetch gift card" });
    }
  }
);

/**
 * POST /gift-cards
 * Create a new gift card
 */
router.post(
  "/",
  requireAuth,
  requirePermission("gift-cards:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const adminId = req.user!.id;
      const validation = createGiftCardSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
      }

      const { code, expiresAt, ...data } = validation.data;
      
      // Generate code if not provided
      let giftCardCode = code?.toUpperCase().replace(/\s/g, "") || generateGiftCardCode();
      
      // Ensure unique
      while (await prisma.giftCard.findUnique({ where: { code: giftCardCode } })) {
        giftCardCode = generateGiftCardCode();
      }

      const giftCard = await prisma.giftCard.create({
        data: {
          ...data,
          code: giftCardCode,
          currentBalance: data.initialValue,
          status: "PENDING",
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          createdBy: adminId,
        },
      });

      return res.status(201).json(giftCard);
    } catch (error) {
      console.error("Error creating gift card:", error);
      return res.status(500).json({ error: "Failed to create gift card" });
    }
  }
);

/**
 * POST /gift-cards/bulk
 * Generate multiple gift cards
 */
router.post(
  "/bulk",
  requireAuth,
  requirePermission("gift-cards:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const adminId = req.user!.id;
      const { count = 10, initialValue, currency = "USD", expiresAt } = req.body;

      if (!initialValue || count < 1 || count > 100) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const giftCards: any[] = [];
      const existingCodes = new Set<string>();

      for (let i = 0; i < count; i++) {
        let code = generateGiftCardCode();
        while (existingCodes.has(code)) {
          code = generateGiftCardCode();
        }
        existingCodes.add(code);
        
        giftCards.push({
          code,
          initialValue,
          currentBalance: initialValue,
          currency,
          status: "PENDING",
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          createdBy: adminId,
        });
      }

      const result = await prisma.giftCard.createMany({
        data: giftCards,
        skipDuplicates: true,
      });

      return res.status(201).json({
        success: true,
        created: result.count,
        codes: giftCards.map(g => g.code),
      });
    } catch (error) {
      console.error("Error creating bulk gift cards:", error);
      return res.status(500).json({ error: "Failed to create gift cards" });
    }
  }
);

/**
 * POST /gift-cards/:id/activate
 * Activate a gift card
 */
router.post(
  "/:id/activate",
  requireAuth,
  requirePermission("gift-cards:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;

      const giftCard = await prisma.giftCard.update({
        where: { id: parseInt(id, 10) },
        data: {
          status: "ACTIVE",
          activatedAt: new Date(),
          updatedBy: adminId,
        },
      });

      return res.status(200).json(giftCard);
    } catch (error) {
      console.error("Error activating gift card:", error);
      return res.status(500).json({ error: "Failed to activate gift card" });
    }
  }
);

/**
 * POST /gift-cards/:id/cancel
 * Cancel a gift card
 */
router.post(
  "/:id/cancel",
  requireAuth,
  requirePermission("gift-cards:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;

      const giftCard = await prisma.giftCard.update({
        where: { id: parseInt(id, 10) },
        data: {
          status: "CANCELLED",
          updatedBy: adminId,
        },
      });

      return res.status(200).json(giftCard);
    } catch (error) {
      console.error("Error cancelling gift card:", error);
      return res.status(500).json({ error: "Failed to cancel gift card" });
    }
  }
);

/**
 * POST /gift-cards/:id/adjust
 * Manually adjust gift card balance
 */
router.post(
  "/:id/adjust",
  requireAuth,
  requirePermission("gift-cards:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id!;
      const adminId = req.user!.id;
      const { amount, description } = req.body;

      if (!amount || typeof amount !== "number") {
        return res.status(400).json({ error: "Amount is required" });
      }

      const giftCard = await prisma.giftCard.findUnique({
        where: { id: parseInt(id, 10) },
      });

      if (!giftCard) {
        return res.status(404).json({ error: "Gift card not found" });
      }

      const newBalance = giftCard.currentBalance + amount;
      if (newBalance < 0) {
        return res.status(400).json({ error: "Adjustment would result in negative balance" });
      }

      const newStatus = newBalance === 0 ? "DEPLETED" : 
                        newBalance === giftCard.initialValue ? "ACTIVE" : "PARTIALLY_USED";

      const [updatedCard, transaction] = await prisma.$transaction([
        prisma.giftCard.update({
          where: { id: giftCard.id },
          data: {
            currentBalance: newBalance,
            status: newStatus,
            updatedBy: adminId,
          },
        }),
        prisma.giftCardTransaction.create({
          data: {
            giftCardId: giftCard.id,
            amount,
            balanceAfter: newBalance,
            description: description || `Manual adjustment by admin`,
            performedBy: adminId,
            actorUserId: adminId,
            actorType: "ADMIN",
            createdBy: adminId,
          },
        }),
      ]);

      return res.status(200).json({
        giftCard: updatedCard,
        transaction,
      });
    } catch (error) {
      console.error("Error adjusting gift card:", error);
      return res.status(500).json({ error: "Failed to adjust gift card" });
    }
  }
);

export default router;
