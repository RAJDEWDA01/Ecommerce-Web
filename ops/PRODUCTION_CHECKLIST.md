# Production Deployment Checklist

Use this checklist before exposing traffic to customers.

## 1) Server Baseline

- Provision Linux VM with Docker + Docker Compose plugin.
- Open firewall ports: `80` (and `443` when TLS terminates on this host).
- Point DNS `A` record for your domain to the server IP.

## 2) Environment Files

### Backend env

1. Copy production template:
```bash
cp backend/.env.production.example backend/.env.production
```
2. Fill all required values in `backend/.env.production`:
- `MONGO_URI`
- `JWT_SECRET`
- `FRONTEND_URL`
- `CORS_ORIGIN`
- SMTP values (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)
- `ADMIN_NOTIFICATION_EMAILS`
- Razorpay keys (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) if payments are enabled

For local DB/Redis containers in `docker-compose.prod.yml`, use:
- `MONGO_URI=mongodb://mongo:27017/gaumaya`
- `REDIS_URL=redis://redis:6379`

### Compose env

1. Copy compose template:
```bash
cp .env.production.compose.example .env.production.compose
```
2. Set:
- `APP_DOMAIN` (example: `shop.example.com`)
- `PUBLIC_HTTP_PORT` (usually `80`)
- `NEXT_PUBLIC_API_BASE_URL` (keep empty for same-domain `/api` proxy)
- `PUBLIC_HTTPS_PORT` (usually `443`, for TLS deployment)
- `TLS_CERT_PATH` and `TLS_KEY_PATH` (for TLS deployment)

## 3) Start Production Stack

```bash
docker compose --env-file .env.production.compose -f docker-compose.prod.yml up -d --build
```

### Start with HTTPS (TLS)

```bash
docker compose --env-file .env.production.compose -f docker-compose.prod.yml -f docker-compose.prod.tls.yml up -d --build
```

Before HTTPS start, place cert files in `ops/nginx/certs/`:
- `fullchain.pem`
- `privkey.pem`

## 4) Smoke Tests

- App homepage:
```bash
curl -i http://<your-domain>/
```
- Backend health through Nginx:
```bash
curl -i http://<your-domain>/api/health/ready
```
- Ensure containers are healthy:
```bash
docker compose --env-file .env.production.compose -f docker-compose.prod.yml ps
```

## 5) Post-Deploy Hardening

- Enable TLS termination (Cloudflare, LB, or host-level certificate).
- Restrict SSH to key-based auth and disable password auth.
- Schedule backups using `ops/backup/*` scripts.
- Configure external monitoring for:
  - `/api/health/ready`
  - container restarts
  - disk usage and memory

## 6) Routine Operations

- View logs:
```bash
docker compose --env-file .env.production.compose -f docker-compose.prod.yml logs -f --tail=200
```
- Rolling restart:
```bash
docker compose --env-file .env.production.compose -f docker-compose.prod.yml up -d --build
```
- Rolling deploy script (health-checked, near-zero-downtime):
```bash
./ops/deploy/rolling-deploy.sh
```
- Rolling deploy with HTTPS overlay:
```bash
COMPOSE_FILES=docker-compose.prod.yml,docker-compose.prod.tls.yml ./ops/deploy/rolling-deploy.sh
```
- Stop stack:
```bash
docker compose --env-file .env.production.compose -f docker-compose.prod.yml down
```
