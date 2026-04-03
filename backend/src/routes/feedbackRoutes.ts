import express from 'express';
import type { Request } from 'express';
import { createFeedback } from '../controllers/feedbackController.js';
import { attachCustomerIfPresent, type CustomerAuthRequest } from '../middleware/customerAuth.js';
import { createRateLimiter, readRateLimitFromEnv } from '../middleware/rateLimit.js';

const router = express.Router();

const feedbackCreateRateLimit = readRateLimitFromEnv('FEEDBACK_CREATE_LIMIT', {
  maxRequests: 20,
  windowMinutes: 10,
});

const feedbackRateKey = (req: Request): string => {
  const customer = (req as CustomerAuthRequest).customer;

  if (customer) {
    return `customer:${customer.id}`;
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
};

const limitCreateFeedback = createRateLimiter({
  identifier: 'feedback_create',
  ...feedbackCreateRateLimit,
  message: 'Too many feedback submissions in a short time. Please wait and try again.',
  keyGenerator: feedbackRateKey,
});

router.route('/').post(attachCustomerIfPresent, limitCreateFeedback, createFeedback);

export default router;
