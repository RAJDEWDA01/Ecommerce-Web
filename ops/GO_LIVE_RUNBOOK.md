# Go-Live Runbook (Copy-Paste Order)

This is the fastest safe path to launch on one server with HTTPS.

## 1) Prepare env files

```bash
cp backend/.env.production.example backend/.env.production
cp .env.production.compose.example .env.production.compose
```

If you want pre-arranged templates with placeholders, use:

```bash
cp ops/env/backend.env.production.fillme backend/.env.production
cp ops/env/compose.env.production.fillme .env.production.compose
```

## 2) Fill `.env.production.compose`

Set these values:

```env
APP_DOMAIN=shop.your-domain.com
PUBLIC_HTTP_PORT=80
PUBLIC_HTTPS_PORT=443
NEXT_PUBLIC_API_BASE_URL=
TLS_CERT_PATH=/etc/nginx/certs/fullchain.pem
TLS_KEY_PATH=/etc/nginx/certs/privkey.pem
```

Notes:
- Keep `NEXT_PUBLIC_API_BASE_URL` empty for same-domain proxy (`/api` through Nginx).
- HTTPS cert files must exist in `ops/nginx/certs/` as:
  - `fullchain.pem`
  - `privkey.pem`

## 3) Fill `backend/.env.production`

Required for launch:

```env
NODE_ENV=production
PORT=5000
LOG_LEVEL=info
MONGO_URI=mongodb://mongo:27017/gaumaya
REDIS_URL=redis://redis:6379
JWT_SECRET=<minimum-32-char-random-secret>
CORS_ORIGIN=https://shop.your-domain.com
FRONTEND_URL=https://shop.your-domain.com
TRUST_PROXY=true
```

Uploads (pick one; recommended: Cloudinary free tier):

```env
UPLOAD_DRIVER=cloudinary
CLOUDINARY_CLOUD_NAME=<your cloud name>   # shown in Cloudinary dashboard and in https://res.cloudinary.com/<cloud_name>/
CLOUDINARY_API_KEY=<from Cloudinary API keys>
CLOUDINARY_API_SECRET=<from Cloudinary API keys>
CLOUDINARY_FOLDER=gaumaya-uploads
```

Email and admin ops (strongly recommended for production):

```env
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=Gaumaya Farm <no-reply@your-domain.com>
ADMIN_NOTIFICATION_EMAILS=ops@your-domain.com,owner@your-domain.com
```

Payments (required for online payment mode):

```env
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=xxx
RAZORPAY_WEBHOOK_SECRET=xxx
```

Bootstrap admin:

```env
BOOTSTRAP_ADMIN_NAME=Store Admin
BOOTSTRAP_ADMIN_EMAIL=admin@your-domain.com
BOOTSTRAP_ADMIN_PASSWORD=<strong-password>
```

## 4) Start HTTPS stack

```bash
docker compose --env-file .env.production.compose -f docker-compose.prod.yml -f docker-compose.prod.tls.yml up -d --build
```

## 5) Seed admin user

```bash
docker compose --env-file .env.production.compose -f docker-compose.prod.yml -f docker-compose.prod.tls.yml exec backend npm run seed:admin:prod
```

## 6) Smoke test (must pass)

```bash
curl -i https://shop.your-domain.com/
curl -i https://shop.your-domain.com/api/health
curl -i https://shop.your-domain.com/api/health/ready
docker compose --env-file .env.production.compose -f docker-compose.prod.yml -f docker-compose.prod.tls.yml ps
```

Expect:
- homepage returns `200`
- `/api/health` returns `200`
- `/api/health/ready` returns `200` with Mongo connected
- all containers show healthy/running

## 7) Configure payment webhook

In Razorpay dashboard, set webhook URL to:

```text
https://shop.your-domain.com/api/payments/webhook
```

Use the same secret value as `RAZORPAY_WEBHOOK_SECRET`.

## 8) First live transaction checklist

- Place one real low-value order.
- Verify payment success.
- Confirm order appears in Admin Orders.
- Confirm admin notification email is delivered.
- If refund flow is tested, confirm webhook updates settlement status.

## 9) Ongoing deploys (same code on server)

Use rolling deploy script:

```bash
COMPOSE_FILES=docker-compose.prod.yml,docker-compose.prod.tls.yml ./ops/deploy/rolling-deploy.sh
```

## 10) Update from GitHub, then deploy

Use this flow each time you push new changes to GitHub and want them live:

```bash
cd /path/to/gaumaya-ecommerce
git fetch origin
git checkout main
git pull --rebase origin main
COMPOSE_FILES=docker-compose.prod.yml,docker-compose.prod.tls.yml ./ops/deploy/rolling-deploy.sh
```

Quick verification:

```bash
curl -i https://shop.your-domain.com/api/health/ready
docker compose --env-file .env.production.compose -f docker-compose.prod.yml -f docker-compose.prod.tls.yml ps
```
