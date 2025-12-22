import { z } from "zod";

// Promotion schemas
export const createPromotionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  internalNotes: z.string().optional(),
  type: z.enum(["PERCENTAGE_OFF", "FIXED_AMOUNT_OFF", "BUY_X_GET_Y", "FREE_SHIPPING", "BUNDLE_DISCOUNT"]),
  target: z.enum(["ORDER", "PRODUCT", "CATEGORY", "SHIPPING", "BRAND"]).default("ORDER"),
  discountValue: z.number().int(),
  discountPercent: z.number().int().min(0).max(10000).optional(),
  maxDiscountAmount: z.number().int().optional(),
  minOrderAmount: z.number().int().optional(),
  minQuantity: z.number().int().optional(),
  targetProductIds: z.array(z.string()).default([]),
  targetCategories: z.array(z.string()).default([]),
  targetBrands: z.array(z.string()).default([]),
  excludeProductIds: z.array(z.string()).default([]),
  excludeCategories: z.array(z.string()).default([]),
  targetCustomerIds: z.array(z.string()).default([]),
  targetSegments: z.array(z.string()).default([]),
  firstOrderOnly: z.boolean().default(false),
  totalUsageLimit: z.number().int().optional(),
  perUserLimit: z.number().int().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  stackable: z.boolean().default(false),
  stackingBehavior: z.enum(["STACKABLE", "EXCLUSIVE", "EXCLUSIVE_GROUP"]).default("STACKABLE"),
  stackingPriority: z.number().int().default(0),
  exclusiveGroup: z.string().optional(),
  autoApply: z.boolean().default(false),
});

export const updatePromotionSchema = createPromotionSchema.partial();

// Coupon schemas
export const createCouponSchema = z.object({
  code: z.string().min(3).max(50).transform(s => s.toUpperCase()),
  couponType: z.enum(["SINGLE_USE", "MULTI_USE", "USER_LIMITED"]).default("MULTI_USE"),
  promotionId: z.number().int(),
  totalUsageLimit: z.number().int().optional(),
  perUserLimit: z.number().int().optional(),
  isActive: z.boolean().default(true),
  expiresAt: z.string().datetime().optional(),
});

export const updateCouponSchema = z.object({
  couponType: z.enum(["SINGLE_USE", "MULTI_USE", "USER_LIMITED"]).optional(),
  totalUsageLimit: z.number().int().optional(),
  perUserLimit: z.number().int().optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const validateCouponSchema = z.object({
  code: z.string(),
  cartTotal: z.number().int(),
  cartItems: z.array(z.object({
    productId: z.string(),
    categoryId: z.string().optional(),
    brandId: z.string().optional(),
    quantity: z.number().int(),
    price: z.number().int(),
  })).optional(),
});

// Gift card schemas
export const createGiftCardSchema = z.object({
  code: z.string().optional(), // Auto-generate if not provided
  pin: z.string().optional(),
  initialValue: z.number().int().min(100), // Min $1
  currency: z.string().default("USD"),
  purchasedForEmail: z.string().email().optional(),
  recipientName: z.string().optional(),
  personalMessage: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const redeemGiftCardSchema = z.object({
  code: z.string(),
  pin: z.string().optional(),
  amount: z.number().int(),
  orderId: z.string(),
});

// Wallet schemas
export const creditWalletSchema = z.object({
  userId: z.string(),
  amount: z.number().int().min(1),
  description: z.string(),
  internalNotes: z.string().optional(),
  orderId: z.string().optional(),
  refundId: z.string().optional(),
  giftCardId: z.number().int().optional(),
  promotionId: z.number().int().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const debitWalletSchema = z.object({
  amount: z.number().int().min(1),
  orderId: z.string(),
  description: z.string().optional(),
});

// Promotion condition schemas
export const createConditionSchema = z.object({
  conditionType: z.enum([
    "MIN_ORDER_AMOUNT", "MIN_QUANTITY", "PRODUCT_IN_CART", "CATEGORY_IN_CART",
    "BRAND_IN_CART", "CUSTOMER_SEGMENT", "FIRST_ORDER", "NTH_ORDER",
    "CUSTOMER_TAG", "DATE_RANGE", "TIME_OF_DAY", "DAY_OF_WEEK",
    "CART_CONTAINS_ALL", "CART_CONTAINS_ANY"
  ]),
  operator: z.enum([
    "EQUALS", "NOT_EQUALS", "GREATER_THAN", "LESS_THAN",
    "GREATER_OR_EQUAL", "LESS_OR_EQUAL", "IN", "NOT_IN", "CONTAINS", "BETWEEN"
  ]).default("EQUALS"),
  value: z.string(), // JSON-encoded
  groupId: z.number().int().default(0),
  sortOrder: z.number().int().default(0),
  negate: z.boolean().default(false),
});

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
export type CreateGiftCardInput = z.infer<typeof createGiftCardSchema>;
export type RedeemGiftCardInput = z.infer<typeof redeemGiftCardSchema>;
export type CreditWalletInput = z.infer<typeof creditWalletSchema>;
export type DebitWalletInput = z.infer<typeof debitWalletSchema>;
export type CreateConditionInput = z.infer<typeof createConditionSchema>;
