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
 * @openapi
 * /gift-cards/check/{code}:
 *   get:
 *     summary: Check gift card balance
 *     description: Check the current balance and status of a gift card (public)
 *     tags:
 *       - Gift Cards
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Gift card code
 *     responses:
 *       200:
 *         description: Gift card balance information
 *       400:
 *         description: Gift card cancelled or expired
 *       404:
 *         description: Gift card not found
 *       500:
 *         description: Server error
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
 * @openapi
 * /gift-cards/redeem:
 *   post:
 *     summary: Redeem gift card
 *     description: Apply gift card balance to an order
 *     tags:
 *       - Gift Cards
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
 *               - code
 *               - amount
 *               - orderId
 *             properties:
 *               code:
 *                 type: string
 *                 description: Gift card code
 *               pin:
 *                 type: string
 *                 description: Gift card PIN (if required)
 *               amount:
 *                 type: integer
 *                 description: Amount to redeem in cents
 *               orderId:
 *                 type: string
 *                 description: Order ID for redemption
 *     responses:
 *       200:
 *         description: Gift card redeemed successfully
 *       400:
 *         description: Invalid PIN, insufficient balance, or card status
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Gift card not found
 *       500:
 *         description: Server error
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
 * @openapi
 * /gift-cards:
 *   get:
 *     summary: List all gift cards
 *     description: Retrieve paginated list of gift cards with filtering (admin)
 *     tags:
 *       - Gift Cards
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
 *           enum: [PENDING, ACTIVE, PARTIALLY_USED, DEPLETED, EXPIRED, CANCELLED]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by code, email, or recipient name
 *     responses:
 *       200:
 *         description: List of gift cards with pagination
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
 * @openapi
 * /gift-cards/{id}:
 *   get:
 *     summary: Get gift card by ID
 *     description: Retrieve detailed information about a specific gift card (admin)
 *     tags:
 *       - Gift Cards
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Gift card ID, UUID, or code
 *     responses:
 *       200:
 *         description: Gift card details with transaction history
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       404:
 *         description: Gift card not found
 *       500:
 *         description: Server error
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
 * @openapi
 * /gift-cards:
 *   post:
 *     summary: Create gift card
 *     description: Create a new gift card with optional code (admin)
 *     tags:
 *       - Gift Cards
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
 *               - initialValue
 *             properties:
 *               code:
 *                 type: string
 *                 description: Custom code (auto-generated if not provided)
 *               initialValue:
 *                 type: integer
 *                 description: Initial value in cents
 *               currency:
 *                 type: string
 *                 default: USD
 *               pin:
 *                 type: string
 *                 description: Optional PIN for security
 *               purchasedForEmail:
 *                 type: string
 *               recipientName:
 *                 type: string
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Gift card created
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
 * @openapi
 * /gift-cards/bulk:
 *   post:
 *     summary: Generate bulk gift cards
 *     description: Generate multiple gift cards at once (admin)
 *     tags:
 *       - Gift Cards
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
 *               - initialValue
 *             properties:
 *               count:
 *                 type: integer
 *                 default: 10
 *                 minimum: 1
 *                 maximum: 100
 *               initialValue:
 *                 type: integer
 *               currency:
 *                 type: string
 *                 default: USD
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Bulk gift cards created
 *       400:
 *         description: Invalid parameters
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
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
 * @openapi
 * /gift-cards/{id}/activate:
 *   post:
 *     summary: Activate gift card
 *     description: Activate a pending gift card (admin)
 *     tags:
 *       - Gift Cards
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
 *         description: Gift card activated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
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
 * @openapi
 * /gift-cards/{id}/cancel:
 *   post:
 *     summary: Cancel gift card
 *     description: Cancel a gift card (admin)
 *     tags:
 *       - Gift Cards
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
 *         description: Gift card cancelled
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       500:
 *         description: Server error
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
 * @openapi
 * /gift-cards/{id}/adjust:
 *   post:
 *     summary: Adjust gift card balance
 *     description: Manually adjust gift card balance (admin)
 *     tags:
 *       - Gift Cards
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
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Amount to adjust (positive or negative)
 *               description:
 *                 type: string
 *                 description: Reason for adjustment
 *     responses:
 *       200:
 *         description: Gift card balance adjusted
 *       400:
 *         description: Invalid amount or would result in negative balance
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       404:
 *         description: Gift card not found
 *       500:
 *         description: Server error
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
