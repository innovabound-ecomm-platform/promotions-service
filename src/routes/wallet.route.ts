import { Router } from "express";
import { getPromotionsPrisma } from "@innovabound-ecomm-platform/promotions-db";
import { requireAuth, requirePermission, AuthenticatedRequest } from "../middleware/auth";
import { creditWalletSchema, debitWalletSchema } from "../schemas/promotion.schema";
import { getSiteId, requireSiteId, walletWhere, withSiteId } from "../utils/tenant.utils";

const router: Router = Router();
const prisma = getPromotionsPrisma();

// ============================================
// USER ROUTES
// ============================================

/**
 * @openapi
 * /wallets/me:
 *   get:
 *     summary: Get current user's wallet
 *     description: Retrieve wallet information for authenticated user
 *     tags:
 *       - Wallet
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: User wallet information
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const siteId = getSiteId(req);

    let wallet = await prisma.wallet.findFirst({
      where: walletWhere(siteId, { userId }, { strict: false }),
    });

    // Auto-create wallet if doesn't exist
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: withSiteId({
          userId,
          createdBy: userId,
        }, siteId),
      });
    }

    return res.status(200).json({
      id: wallet.uuid,
      balance: wallet.balance,
      currency: wallet.currency,
      totalCredited: wallet.totalCredited,
      totalDebited: wallet.totalDebited,
    });
  } catch (error) {
    console.error("Error fetching wallet:", error);
    return res.status(500).json({ error: "Failed to fetch wallet" });
  }
});

/**
 * @openapi
 * /wallets/me/transactions:
 *   get:
 *     summary: Get user's wallet transactions
 *     description: Retrieve transaction history for authenticated user's wallet
 *     tags:
 *       - Wallet
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
 *           default: 20
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Wallet transactions with pagination
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get("/me/transactions", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const siteId = getSiteId(req);
    const { page = "1", limit = "20" } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = Math.min(parseInt(limit as string, 10), 50);

    const wallet = await prisma.wallet.findFirst({
      where: walletWhere(siteId, { userId }, { strict: false }),
      select: { id: true },
    });

    if (!wallet) {
      return res.status(200).json({
        data: [],
        pagination: { page: 1, limit: limitNum, total: 0, totalPages: 0 },
      });
    }

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.walletTransaction.count({
        where: { walletId: wallet.id },
      }),
    ]);

    return res.status(200).json({
      data: transactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    return res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

/**
 * @openapi
 * /wallets/debit:
 *   post:
 *     summary: Debit wallet
 *     description: Deduct amount from user's wallet for order payment
 *     tags:
 *       - Wallet
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
 *               - amount
 *               - orderId
 *             properties:
 *               amount:
 *                 type: integer
 *                 description: Amount to debit in cents
 *               orderId:
 *                 type: string
 *                 description: Order ID for transaction
 *               description:
 *                 type: string
 *                 description: Transaction description
 *     responses:
 *       200:
 *         description: Wallet debited successfully
 *       400:
 *         description: Insufficient balance or validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Wallet not found
 *       500:
 *         description: Server error
 */
router.post("/debit", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const validation = debitWalletSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors });
    }

    const { amount, orderId, description } = validation.data;
    const siteId = getSiteId(req);

    const wallet = await prisma.wallet.findFirst({
      where: walletWhere(siteId, { userId }, { strict: false }),
    });

    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    if (wallet.balance < amount) {
      return res.status(400).json({ 
        error: "Insufficient balance",
        availableBalance: wallet.balance,
      });
    }

    const newBalance = wallet.balance - amount;

    const [updatedWallet, transaction] = await prisma.$transaction([
      prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: newBalance,
          totalDebited: { increment: amount },
          updatedBy: userId,
        },
      }),
      prisma.walletTransaction.create({
        data: withSiteId({
          walletId: wallet.id,
          type: "DEBIT",
          amount,
          balanceAfter: newBalance,
          orderId,
          description: description || `Payment for order ${orderId}`,
          performedBy: userId,
          actorUserId: userId,
          actorType: "USER",
          createdBy: userId,
        }, siteId),
      }),
    ]);

    // Record redemption for analytics
    await prisma.promotionRedemption.create({
      data: withSiteId({
        type: "WALLET",
        walletId: wallet.id,
        orderId,
        userId,
        discountAmount: amount,
        currency: wallet.currency,
        actorUserId: userId,
        actorType: "USER",
        createdBy: userId,
      }, siteId),
    });

    return res.status(200).json({
      success: true,
      amountDebited: amount,
      newBalance,
      transactionId: transaction.uuid,
    });
  } catch (error) {
    console.error("Error debiting wallet:", error);
    return res.status(500).json({ error: "Failed to debit wallet" });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

/**
 * @openapi
 * /wallets:
 *   get:
 *     summary: List all wallets
 *     description: Retrieve paginated list of all wallets (admin)
 *     tags:
 *       - Wallet
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
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by user ID
 *       - in: query
 *         name: minBalance
 *         schema:
 *           type: integer
 *         description: Filter by minimum balance
 *     responses:
 *       200:
 *         description: List of wallets with pagination
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
  requirePermission("wallets:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { 
        page = "1", 
        limit = "50",
        search,
        minBalance,
      } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 100);
      const siteId = getSiteId(req);

      const additionalWhere: any = {};

      if (search) {
        additionalWhere.userId = { contains: search as string };
      }

      if (minBalance) {
        additionalWhere.balance = { gte: parseInt(minBalance as string, 10) };
      }

      const where = walletWhere(siteId, additionalWhere);

      const [wallets, total] = await Promise.all([
        prisma.wallet.findMany({
          where,
          orderBy: { balance: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.wallet.count({ where }),
      ]);

      return res.status(200).json({
        data: wallets,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error("Error fetching wallets:", error);
      return res.status(500).json({ error: "Failed to fetch wallets" });
    }
  }
);

/**
 * @openapi
 * /wallets/{userId}:
 *   get:
 *     summary: Get wallet by user ID
 *     description: Retrieve wallet details for a specific user (admin)
 *     tags:
 *       - Wallet
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Wallet details with recent transactions
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       404:
 *         description: Wallet not found
 *       500:
 *         description: Server error
 */
router.get(
  "/:userId",
  requireAuth,
  requirePermission("wallets:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { userId } = req.params;
      const siteId = getSiteId(req);

      const wallet = await prisma.wallet.findFirst({
        where: walletWhere(siteId, { userId }),
        include: {
          transactions: {
            orderBy: { createdAt: "desc" },
            take: 20,
          },
        },
      });

      if (!wallet) {
        return res.status(404).json({ error: "Wallet not found" });
      }

      return res.status(200).json(wallet);
    } catch (error) {
      console.error("Error fetching wallet:", error);
      return res.status(500).json({ error: "Failed to fetch wallet" });
    }
  }
);

/**
 * @openapi
 * /wallets/credit:
 *   post:
 *     summary: Credit wallet
 *     description: Add credit to a user's wallet (admin)
 *     tags:
 *       - Wallet
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
 *               - userId
 *               - amount
 *             properties:
 *               userId:
 *                 type: string
 *                 description: User ID to credit
 *               amount:
 *                 type: integer
 *                 description: Amount to credit in cents
 *               description:
 *                 type: string
 *                 description: Credit description
 *               internalNotes:
 *                 type: string
 *                 description: Internal notes for record
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *                 description: Credit expiration date
 *     responses:
 *       200:
 *         description: Wallet credited successfully
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
  "/credit",
  requireAuth,
  requirePermission("wallets:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const adminId = req.user!.id;
      const validation = creditWalletSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
      }

      const { userId, amount, description, internalNotes, expiresAt, ...refs } = validation.data;
      const siteId = requireSiteId(req);

      // Get or create wallet
      let wallet = await prisma.wallet.findFirst({
        where: walletWhere(siteId, { userId }),
      });

      if (!wallet) {
        wallet = await prisma.wallet.create({
          data: withSiteId({
            userId,
            createdBy: adminId,
          }, siteId),
        });
      }

      const newBalance = wallet.balance + amount;

      const [updatedWallet, transaction] = await prisma.$transaction([
        prisma.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: newBalance,
            totalCredited: { increment: amount },
            updatedBy: adminId,
          },
        }),
        prisma.walletTransaction.create({
          data: withSiteId({
            walletId: wallet.id,
            type: "CREDIT",
            amount,
            balanceAfter: newBalance,
            description,
            internalNotes,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            ...refs,
            performedBy: adminId,
            actorUserId: adminId,
            actorType: "ADMIN",
            createdBy: adminId,
          }, siteId),
        }),
      ]);

      return res.status(200).json({
        success: true,
        wallet: updatedWallet,
        transaction,
      });
    } catch (error) {
      console.error("Error crediting wallet:", error);
      return res.status(500).json({ error: "Failed to credit wallet" });
    }
  }
);

/**
 * @openapi
 * /wallets/{userId}/adjust:
 *   post:
 *     summary: Adjust wallet balance
 *     description: Manually adjust wallet balance (admin)
 *     tags:
 *       - Wallet
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
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
 *                 description: Adjustment description
 *               internalNotes:
 *                 type: string
 *                 description: Internal notes
 *     responses:
 *       200:
 *         description: Wallet adjusted successfully
 *       400:
 *         description: Invalid amount or would result in negative balance
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 *       404:
 *         description: Wallet not found
 *       500:
 *         description: Server error
 */
router.post(
  "/:userId/adjust",
  requireAuth,
  requirePermission("wallets:write"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { userId } = req.params;
      const adminId = req.user!.id;
      const { amount, description, internalNotes } = req.body;

      if (!amount || typeof amount !== "number") {
        return res.status(400).json({ error: "Amount is required" });
      }

      const siteId = requireSiteId(req);

      const wallet = await prisma.wallet.findFirst({
        where: walletWhere(siteId, { userId }),
      });

      if (!wallet) {
        return res.status(404).json({ error: "Wallet not found" });
      }

      const newBalance = wallet.balance + amount;
      if (newBalance < 0) {
        return res.status(400).json({ error: "Adjustment would result in negative balance" });
      }

      const [updatedWallet, transaction] = await prisma.$transaction([
        prisma.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: newBalance,
            ...(amount > 0 ? { totalCredited: { increment: amount } } : { totalDebited: { increment: Math.abs(amount) } }),
            updatedBy: adminId,
          },
        }),
        prisma.walletTransaction.create({
          data: withSiteId({
            walletId: wallet.id,
            type: "ADJUSTMENT",
            amount: Math.abs(amount),
            balanceAfter: newBalance,
            description: description || `Manual adjustment by admin`,
            internalNotes,
            performedBy: adminId,
            actorUserId: adminId,
            actorType: "ADMIN",
            createdBy: adminId,
          }, siteId),
        }),
      ]);

      return res.status(200).json({
        success: true,
        wallet: updatedWallet,
        transaction,
      });
    } catch (error) {
      console.error("Error adjusting wallet:", error);
      return res.status(500).json({ error: "Failed to adjust wallet" });
    }
  }
);

export default router;
