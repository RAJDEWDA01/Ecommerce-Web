# Gaumaya Ecommerce

Full-stack ecommerce project with:
- `frontend` (Next.js 16, App Router, Zustand)
- `backend` (Express + TypeScript + MongoDB + Redis optional)

## 1) Local Development

### Backend
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### Frontend
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## 2) Quick Docker Compose (Single Host)

1. Create `backend/.env` from `backend/.env.example` and fill required secrets:
- `MONGO_URI` (ignored by compose override but keep valid)
- `JWT_SECRET`
- Razorpay/SMTP values as needed
- optional admin alert recipients: `ADMIN_NOTIFICATION_EMAILS` (comma-separated)
- for production deployments, start from `backend/.env.production.example`

2. Run:
```bash
docker compose up --build
```

3. Access:
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:5000`

## 3) Production Deployment Pack (Nginx + Frontend + Backend + Mongo + Redis)

- Compose file: `docker-compose.prod.yml`
- HTTPS overlay compose file: `docker-compose.prod.tls.yml`
- Nginx template: `ops/nginx/templates/default.conf.template`
- Nginx TLS template: `ops/nginx/templates/default.tls.conf.template`
- Operations checklist: `ops/PRODUCTION_CHECKLIST.md`
- Go-live runbook: `ops/GO_LIVE_RUNBOOK.md`
- Compose env template: `.env.production.compose.example`
- Fill-ready env templates: `ops/env/backend.env.production.fillme`, `ops/env/compose.env.production.fillme`
- Rolling deploy scripts: `ops/deploy/rolling-deploy.sh`, `ops/deploy/rolling-deploy.ps1`

### Launch commands

```bash
cp backend/.env.production.example backend/.env.production
cp .env.production.compose.example .env.production.compose
docker compose --env-file .env.production.compose -f docker-compose.prod.yml up -d --build
```

### Notes

- Keep `NEXT_PUBLIC_API_BASE_URL` empty in production compose env for same-domain `/api` proxying.
- If you use included Mongo/Redis services, set `MONGO_URI=mongodb://mongo:27017/gaumaya` and `REDIS_URL=redis://redis:6379` in `backend/.env.production`.
- HTTPS mode (Nginx TLS in-container):
```bash
docker compose --env-file .env.production.compose -f docker-compose.prod.yml -f docker-compose.prod.tls.yml up -d --build
```
- For HTTPS mode, put cert files in `ops/nginx/certs/` as `fullchain.pem` and `privkey.pem`.
- Rolling deploy (health-checked):
```bash
./ops/deploy/rolling-deploy.sh
```
- Rolling deploy with HTTPS overlay:
```bash
COMPOSE_FILES=docker-compose.prod.yml,docker-compose.prod.tls.yml ./ops/deploy/rolling-deploy.sh
```

## 4) Health Endpoints

- `GET /api/health` (basic status)
- `GET /api/health/live` (liveness)
- `GET /api/health/ready` (readiness with Mongo/Redis status)

## 5) Production Build Commands (without Docker)

### Backend
```bash
cd backend
npm run build
npm run start
```

### Frontend
```bash
cd frontend
npm run build
npm run start
```

## 6) Backend Integration Tests

```bash
cd backend
npm run test
```

Covered flows:
- Customer register/login
- Checkout order creation + idempotent retry
- Payment verification state update
- Admin order status update

Note: On first run, `mongodb-memory-server` downloads a MongoDB binary, so the first test run can take longer.

## 7) Production-Grade Backend Upgrades

- Atomic checkout with MongoDB transaction-first flow (with safe compensated fallback when transactions are unavailable).
- Scalable product listing:
  - `GET /api/products` (legacy array response).
  - `GET /api/products?page=1&limit=20&search=ghee&featured=true&inStock=true&sortBy=price&sortOrder=asc` (paginated response with metadata).
- Scalable order listing:
  - `GET /api/orders?orderStatus=shipped&paymentStatus=paid&page=1&limit=50&fromDate=2026-01-01&toDate=2026-12-31`
  - `GET /api/orders/my-orders?page=1&limit=20&paymentStatus=paid`
- Database indexes added for high-volume order/product filtering and sorting patterns.

## 8) Enterprise Security and Observability (Phase 2)

- Secret hygiene and generation:
  - `cd backend && npm run security:generate` to generate secure `JWT_SECRET` and `BOOTSTRAP_ADMIN_PASSWORD` values.
  - use `backend/.env.production.example` as the baseline for production-only environment files.
  - `BOOTSTRAP_ADMIN_PASSWORD` is enforced as strong (minimum 12 chars with upper/lower/number/special) when running `npm run seed:admin`.
  - `.gitignore` now blocks `.env` and local secrets from accidental commits.
- Structured request logging for every HTTP request with:
  - request id (`X-Request-Id`),
  - actor context (when authenticated),
  - method/path/status/duration/ip.
- Centralized 404 and unhandled error response handling with request-id correlation.
- Role-permission policy middleware for sensitive admin actions (`catalog`, `orders`, `uploads`, `payments`, `audit`).
- Persistent audit trail (`AuditLog`) for high-risk operations:
  - admin login,
  - product create/update/delete,
  - order status update,
  - product image uploads.
- Admin audit log query endpoint:
  - `GET /api/admin/audit-logs?action=orders.status.update&page=1&limit=50`
- Admin audit log CSV export endpoint:
  - `GET /api/admin/audit-logs/export?action=orders.status.update&limit=1000`
- Admin audit analytics endpoint:
  - `GET /api/admin/audit-logs/analytics?action=orders.status.update&days=14&top=5`
- Admin audit alert status endpoint:
  - `GET /api/admin/audit-alerts/status?action=orders.status.update&windowMinutes=15&minEvents=20&warningFailureRate=5&criticalFailureRate=15`
- Admin audit notifier status endpoint:
  - `GET /api/admin/audit-alerts/notifier/status`
- Manual audit notifier run endpoint:
  - `POST /api/admin/audit-alerts/notifier/run`
- Admin audit retention status endpoint:
  - `GET /api/admin/audit-retention/status`
- Manual audit retention run endpoint:
  - `POST /api/admin/audit-retention/run`
- Automated audit retention pruning:
  - configured by `AUDIT_LOG_RETENTION_DAYS` and `AUDIT_LOG_PRUNE_INTERVAL_MINUTES`.
- Admin audit UI now includes quick investigation presets:
  - `Today`, `Failures`, `Admin Actions`.
  - and retention health visibility (last run, next run, last deleted count, last error).
- Admin audit UI analytics snapshot now shows:
  - window totals (count, failures, failure rate, unique actors),
  - daily trend bars,
  - top actions and top actors.
- Admin audit UI now includes live alert status:
  - severity (`ok`, `warning`, `critical`) based on rolling failure-rate window,
  - configured warning/critical thresholds,
  - top failing actions in current alert window.
- Automated audit notifier monitor now supports webhook delivery for critical alerts:
  - scheduler interval, cooldown, and timeout are configurable in `backend/.env`,
  - notifier health and manual run are available in Admin Audit UI.

## 9) CI/CD Quality Gates

- GitHub Actions workflow at `.github/workflows/ci.yml` runs on push and pull requests:
  - backend install + build + tests
  - frontend install + build

## 10) Data Safety and Recovery

- Backup/restore scripts are available in `ops/backup/`:
  - `backup-mongo.ps1` / `backup-mongo.sh`
  - `restore-mongo.ps1` / `restore-mongo.sh`
  - `drill-restore.ps1` / `drill-restore.sh`
- Runbook:
  - `ops/backup/README.md`

## 11) Customer Commerce Features (New)

- Wishlist APIs:
  - `GET /api/wishlist` (customer auth)
  - `POST /api/wishlist/items` with `{ "productId": "<id>" }` (customer auth)
  - `DELETE /api/wishlist/items/:productId` (customer auth)
  - `DELETE /api/wishlist` to clear all (customer auth)
- Coupon/discount APIs:
  - `POST /api/coupons/validate` with `{ "code": "WELCOME10", "subtotal": 500 }`
  - `GET /api/admin/coupons` (admin)
  - `POST /api/admin/coupons` (admin)
  - `PATCH /api/admin/coupons/:id` (admin)
  - `DELETE /api/admin/coupons/:id` (admin)
  - `GET /api/admin/coupons/analytics` (admin)
  - `PATCH /api/admin/coupons/bulk-status` (admin)
- Checkout now supports coupon application:
  - `POST /api/orders` accepts optional `couponCode` and `addressId`
  - `cartItems[]` also accepts optional `variantSku` for variant-specific checkout
  - order stores `discountAmount` and `couponCode`
  - when `addressId` is provided, order also stores `sourceAddressId` and address snapshot metadata
- Order cancellation workflow:
  - `POST /api/orders/:id/cancellation-request` (customer auth) with `{ "reason": "..." }`
  - `PATCH /api/orders/:id/cancellation-request/decision` (admin) with `{ "action": "approve" | "reject", "note": "optional" }`
  - approved cancellations move order to `cancelled` and restore item stock quantities
  - customer receives email notifications when cancellation is requested and when admin approves/rejects
- Refund workflow for paid cancelled orders:
  - `PATCH /api/orders/:id/refund` (admin) with `{ "status": "pending" | "processed" | "failed", "amount": 1200, "reference": "UTR123", "note": "optional" }`
  - cancellation approval for paid orders auto-sets `refundInfo.status = pending`
  - customer receives refund status emails on pending/processed/failed transitions
  - refund filter/search fields on admin order listing: `refundStatus`, `refundReference`, `refundFromDate`, `refundToDate`
  - refund CSV export endpoint: `GET /api/orders/refunds/export`
  - refund analytics endpoint: `GET /api/orders/refunds/analytics`
  - webhook-ready placeholders in `refundInfo`: `gatewayRefundId`, `gatewaySettlementStatus`, `gatewaySettlementAt`
- Fulfillment tracking workflow:
  - `PATCH /api/orders/:id/status` now accepts optional `fulfillment` payload:
    - `courierName`, `trackingNumber`, `trackingUrl`
    - `packedAt`, `shippedAt`, `deliveredAt` (ISO date-time or null)
  - customer account order history shows courier/tracking details and fulfillment timeline
  - shipped/delivered transitions auto-capture missing fulfillment timestamps
  - customer receives status/tracking update emails when fulfillment details or status change
- Customer profile enhancements:
  - `PATCH /api/auth/me` supports profile update (`name`, `phone`)
- Customer care / support ticket APIs:
  - `POST /api/support/tickets`
  - `GET /api/admin/support-tickets` (admin)
  - `PATCH /api/admin/support-tickets/:id/status` (admin)
  - `POST /api/admin/support-tickets/:id/notes` (admin)
- Feedback APIs:
  - `POST /api/feedback`
  - `GET /api/admin/feedback` (admin)
  - `PATCH /api/admin/feedback/:id/status` (admin)
  - both public create endpoints (`/api/support/tickets`, `/api/feedback`) are rate-limited via env:
    - `SUPPORT_TICKET_CREATE_LIMIT_MAX`, `SUPPORT_TICKET_CREATE_LIMIT_WINDOW_MINUTES`
    - `FEEDBACK_CREATE_LIMIT_MAX`, `FEEDBACK_CREATE_LIMIT_WINDOW_MINUTES`
- Admin operational email notifications (when SMTP + recipients are configured):
  - new order placed
  - payment verified/captured/failed
  - refund gateway settlement status updates from webhooks
  - new customer care/support tickets
  - new customer feedback submissions
  - configure recipients using `ADMIN_NOTIFICATION_EMAILS` (comma-separated emails)
  - configure event toggles:
    - `ADMIN_NOTIFICATION_ORDER_ENABLED=true|false`
    - `ADMIN_NOTIFICATION_PAYMENT_ENABLED=true|false`
    - `ADMIN_NOTIFICATION_SUPPORT_ENABLED=true|false`
    - `ADMIN_NOTIFICATION_FEEDBACK_ENABLED=true|false`
  - failed deliveries are persisted and retried automatically in background
  - retry queue configuration:
    - `ADMIN_NOTIFICATION_RETRY_ENABLED=true|false`
    - `ADMIN_NOTIFICATION_RETRY_INTERVAL_MINUTES=5`
    - `ADMIN_NOTIFICATION_RETRY_MAX_ATTEMPTS=5`
    - `ADMIN_NOTIFICATION_RETRY_BASE_DELAY_MINUTES=10`
    - `ADMIN_NOTIFICATION_RETRY_BATCH_SIZE=20`
  - admin failed-delivery visibility endpoint:
    - `GET /api/admin/notification-deliveries?status=failed&retryableOnly=true&page=1&limit=50`
  - admin delivery analytics endpoint:
    - `GET /api/admin/notification-deliveries/analytics?days=14&eventType=order`
  - admin retry worker operational endpoints:
    - `GET /api/admin/notification-deliveries/retry/status`
    - `POST /api/admin/notification-deliveries/retry/run`
  - retention queue configuration:
    - `ADMIN_NOTIFICATION_RETENTION_ENABLED=true|false`
    - `ADMIN_NOTIFICATION_RETENTION_DAYS=180`
    - `ADMIN_NOTIFICATION_RETENTION_INTERVAL_MINUTES=60`
  - admin retention worker operational endpoints:
    - `GET /api/admin/notification-deliveries/retention/status`
    - `POST /api/admin/notification-deliveries/retention/run`
- Saved address APIs (customer auth):
  - `GET /api/addresses`
  - `POST /api/addresses`
  - `PATCH /api/addresses/:id`
  - `PATCH /api/addresses/:id/default`
  - `DELETE /api/addresses/:id`
- Frontend additions:
  - Storefront catalog now supports URL-based search/filter/sort/pagination powered by backend product query params
  - Product details page (`/products/[id]`) with detailed information and similar products
  - Product details now support:
    - multiple product images/gallery thumbnails
    - variant options (e.g., `200ml`, `500ml`, `1kg`) with variant-specific price/stock/SKU
    - customer reviews section with rating summary and review submission
  - Product review APIs:
    - `GET /api/products/:id/reviews`
    - `POST /api/products/:id/reviews` (guest or customer; verified purchase is auto-detected for logged-in customers)
  - Wishlist UI (`/wishlist`)
  - Coupon apply flow in cart + discount reflected in checkout/success
  - Editable account profile section
  - Saved addresses management in account (`/account`)
  - Checkout address prefill from saved default address
  - Customer cancellation request action in account order history
  - Admin review controls for cancellation requests in orders dashboard
  - Refund timeline in customer account order history
  - Admin refund controls in orders dashboard (including gateway placeholder fields)
  - Admin order dashboard refund filters and refunds CSV export
  - Admin order dashboard refund analytics cards
  - Customer care page (`/customer-care`)
  - Customer feedback submission form on customer care page
  - Global footer with company details and support contacts
  - Admin coupons dashboard (`/admin/coupons`)
  - Admin support triage dashboard (`/admin/support`)
  - Admin feedback moderation dashboard (`/admin/feedback`)
