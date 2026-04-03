import express from 'express';
import type { Request } from 'express';
import {
  createPaymentOrder,
  getPaymentWebhookEvents,
  handleRazorpayWebhook,
  verifyPayment,
} from '../controllers/paymentController.js';
import { attachAuthIfPresent, type AuthContextRequest } from '../middleware/authContext.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { createRateLimiter, readRateLimitFromEnv } from '../middleware/rateLimit.js';
import { requirePermission } from '../middleware/authorization.js';

const router = express.Router();

const paymentCreateRateLimit = readRateLimitFromEnv('PAYMENT_CREATE_ORDER_LIMIT', {
  maxRequests: 15,
  windowMinutes: 10,
});

const paymentVerifyRateLimit = readRateLimitFromEnv('PAYMENT_VERIFY_LIMIT', {
  maxRequests: 25,
  windowMinutes: 10,
});

const paymentRateKey = (req: Request): string => {
  const auth = (req as AuthContextRequest).auth;

  if (auth) {
    return `${auth.role}:${auth.id}`;
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
};

const limitCreatePaymentOrder = createRateLimiter({
  identifier: 'payment_create_order',
  ...paymentCreateRateLimit,
  message: 'Too many payment initiation attempts. Please wait and try again.',
  keyGenerator: paymentRateKey,
});

const limitVerifyPayment = createRateLimiter({
  identifier: 'payment_verify',
  ...paymentVerifyRateLimit,
  message: 'Too many payment verification attempts. Please wait and try again.',
  keyGenerator: paymentRateKey,
});

router.route('/create-order').post(attachAuthIfPresent, limitCreatePaymentOrder, createPaymentOrder);
router.route('/verify').post(attachAuthIfPresent, limitVerifyPayment, verifyPayment);
router
  .route('/webhook-events')
  .get(requireAdminAuth, requirePermission('payments:webhooks:read'), getPaymentWebhookEvents);
router.route('/webhook').post(handleRazorpayWebhook);

export default router;
