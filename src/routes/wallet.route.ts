import { Router } from "express";
import { getPromotionsPrisma } from "@innovabound-ecomm-platform/promotions-db";
import { requireAuth, requirePermission, AuthenticatedRequest } from "../middleware/auth";
import { creditWalletSchema, debitWalletSchema } from "../schemas/promotion.schema";

const router: Router = Router();
const prisma = getPromotionsPrisma();

// ============================================
// USER ROUTES
// ============================================

/**
 * GET /wallets/me
 * Get current user's wallet
 */
router.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;

    let wallet = await prisma.wallet.findUnique({
      where: { userId },
    });

    // Auto-create wallet if doesn't exist
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: {
          userId,
          createdBy: userId,
        },
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
 * GET /wallets/me/transactions
 * Get current user's wallet transactions
 */
router.get("/me/transactions", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { page = "1", limit = "20" } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = Math.min(parseInt(limit as string, 10), 50);

    const wallet = await prisma.wallet.findUnique({
      where: { userId },
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
 * POST /wallets/debit
 * Debit wallet for order (called by order service)
 */
router.post("/debit", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const validation = debitWalletSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors });
    }

    const { amount, orderId, description } = validation.data;

    const wallet = await prisma.wallet.findUnique({
      where: { userId },
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
        data: {
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
        },
      }),
    ]);

    // Record redemption for analytics
    await prisma.promotionRedemption.create({
      data: {
        type: "WALLET",
        walletId: wallet.id,
        orderId,
        userId,
        discountAmount: amount,
        currency: wallet.currency,
        actorUserId: userId,
        actorType: "USER",
        createdBy: userId,
      },
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
 * GET /wallets
 * List all wallets (admin)
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

      const where: any = {};

      if (search) {
        where.userId = { contains: search as string };
      }

      if (minBalance) {
        where.balance = { gte: parseInt(minBalance as string, 10) };
      }

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
 * GET /wallets/:userId
 * Get wallet by user ID (admin)
 */
router.get(
  "/:userId",
  requireAuth,
  requirePermission("wallets:read"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { userId } = req.params;

      const wallet = await prisma.wallet.findUnique({
        where: { userId },
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
 * POST /wallets/credit
 * Add credit to a wallet (admin)
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

      // Get or create wallet
      let wallet = await prisma.wallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        wallet = await prisma.wallet.create({
          data: {
            userId,
            createdBy: adminId,
          },
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
          data: {
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
          },
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
 * POST /wallets/:userId/adjust
 * Manual wallet adjustment (admin)
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

      const wallet = await prisma.wallet.findUnique({
        where: { userId },
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
          data: {
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
          },
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
