# Promotions Service

Promotions microservice for the e-commerce platform. Manages discounts, coupons, gift cards, and store credit wallets.

## Features

- **Promotions**: Create and manage percentage/fixed discounts with complex rules
- **Coupons**: Generate and manage coupon codes linked to promotions
- **Gift Cards**: Issue, activate, and manage gift cards
- **Wallets**: Customer store credit management
- **Rule Engine**: Complex promotion conditions (min order, segments, products, etc.)
- **Stacking**: Control which promotions can combine
- **Usage Tracking**: Track redemptions for analytics

## API Endpoints

### Promotions
- `GET /promotions` - List promotions (admin)
- `GET /promotions/active` - Get active auto-apply promotions
- `GET /promotions/:id` - Get promotion details
- `POST /promotions` - Create promotion
- `PUT /promotions/:id` - Update promotion
- `DELETE /promotions/:id` - Delete promotion
- `POST /promotions/:id/publish` - Publish promotion
- `POST /promotions/:id/pause` - Pause promotion

### Coupons
- `GET /coupons` - List coupons (admin)
- `GET /coupons/:code` - Get coupon by code
- `POST /coupons` - Create coupon
- `POST /coupons/validate` - Validate coupon for cart
- `POST /coupons/apply` - Apply coupon to order

### Gift Cards
- `GET /gift-cards` - List gift cards (admin)
- `GET /gift-cards/:code` - Get gift card by code
- `POST /gift-cards` - Create gift card
- `POST /gift-cards/:id/activate` - Activate gift card
- `POST /gift-cards/:id/redeem` - Redeem gift card

### Wallets
- `GET /wallets/me` - Get current user's wallet
- `POST /wallets/credit` - Add credit to wallet (admin)
- `POST /wallets/debit` - Debit wallet for order

## Development

```bash
pnpm install
pnpm dev
```

## Environment Variables

```env
PORT=3009
DATABASE_URL=postgresql://...
KAFKA_BROKERS=localhost:9092
```
