This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

### Lower CPU/RAM development mode

If your laptop lags or crashes in dev:

```bash
npm run dev
```

This project is configured so `npm run dev` uses webpack mode (lighter CPU/RAM).

Other options:

```bash
npm run dev:lite   # even lower memory cap
npm run dev:turbo  # fastest, but usually higher CPU/RAM
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Image Safety / Production Hardening

- Admin Product page now supports importing external image URLs into local backend uploads.
- Use the `Import URL to Local Uploads` button while creating/editing a product, or just save and external URLs are imported automatically.
- Saved image URLs are stored as local `/uploads/...` paths to avoid runtime dependency on third-party hosts.

Frontend env toggles:

```env
NEXT_IMAGE_ALLOW_LOCAL_IP=true
NEXT_IMAGE_ALLOW_THIRD_PARTY=true
```

- For production hardening, set both to `false` (or omit) and rely on local/backend-hosted images.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
## Admin Setup

Admin login is now database-backed (no static admin password in `.env`).

Run this from `backend` to create/update an admin user:

```powershell
$env:BOOTSTRAP_ADMIN_NAME='Store Admin'
$env:BOOTSTRAP_ADMIN_EMAIL='admin@gaumaya.com'
$env:BOOTSTRAP_ADMIN_PASSWORD='ChangeThisStrongPass123!'
npm run seed:admin
```

## Customer Email Flows

Backend now includes:
- Email verification (`/account/verify-email`)
- Forgot password (`/account/forgot-password`)
- Reset password (`/account/reset-password`)

Configure these in `backend/.env`:

```env
FRONTEND_URL=http://localhost:3000
REDIS_URL=
RAZORPAY_WEBHOOK_SECRET=
IDEMPOTENCY_TTL_HOURS=24
IDEMPOTENCY_LOCK_SECONDS=90
PAYMENT_VERIFY_IDEMPOTENCY_TTL_HOURS=24
PAYMENT_VERIFY_IDEMPOTENCY_LOCK_SECONDS=120
EMAIL_VERIFICATION_EXPIRES_HOURS=24
PASSWORD_RESET_EXPIRES_MINUTES=30
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Gaumaya Farm <no-reply@gaumaya.com>
ADMIN_NOTIFICATION_EMAILS=admin@gaumaya.com,ops@gaumaya.com
AUTH_LOGIN_LIMIT_MAX=5
AUTH_LOGIN_LIMIT_WINDOW_MINUTES=15
AUTH_FORGOT_PASSWORD_LIMIT_MAX=5
AUTH_FORGOT_PASSWORD_LIMIT_WINDOW_MINUTES=15
AUTH_VERIFY_RESEND_LIMIT_MAX=3
AUTH_VERIFY_RESEND_LIMIT_WINDOW_MINUTES=15
PAYMENT_CREATE_ORDER_LIMIT_MAX=15
PAYMENT_CREATE_ORDER_LIMIT_WINDOW_MINUTES=10
PAYMENT_VERIFY_LIMIT_MAX=25
PAYMENT_VERIFY_LIMIT_WINDOW_MINUTES=10
SUPPORT_TICKET_CREATE_LIMIT_MAX=15
SUPPORT_TICKET_CREATE_LIMIT_WINDOW_MINUTES=10
FEEDBACK_CREATE_LIMIT_MAX=20
FEEDBACK_CREATE_LIMIT_WINDOW_MINUTES=10
```

When SMTP is not configured in development, the backend response includes debug tokens so you can still test end-to-end.

For production behind a reverse proxy/load balancer, set:

```env
TRUST_PROXY=1
```

If `REDIS_URL` is set, rate limiting uses Redis (recommended for multi-server deployments).  
If not set, it automatically falls back to in-memory limits.

Checkout order creation now supports `X-Idempotency-Key` to prevent duplicate orders on retries/double submit.
Payment verification now supports idempotent retries using deterministic verification keys.

Configure Razorpay webhook to call:
- `POST {BACKEND_BASE_URL}/api/payments/webhook`
- Enable events: `payment.captured`, `payment.failed`

Admin payment reconciliation dashboard:
- UI: `/admin/payments`
- API: `GET /api/payments/webhook-events` (admin token required)

Customer care and feedback:
- UI: `/customer-care` (support ticket form + feedback form)
- Feedback API: `POST /api/feedback`
- Admin feedback moderation UI: `/admin/feedback`
- Admin feedback APIs: `GET /api/admin/feedback`, `PATCH /api/admin/feedback/:id/status`
