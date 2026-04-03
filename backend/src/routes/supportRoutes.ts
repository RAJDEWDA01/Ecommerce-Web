import express from 'express';
import type { Request } from 'express';
import { createSupportTicket } from '../controllers/supportController.js';
import { attachCustomerIfPresent, type CustomerAuthRequest } from '../middleware/customerAuth.js';
import { createRateLimiter, readRateLimitFromEnv } from '../middleware/rateLimit.js';

const router = express.Router();

const supportTicketCreateRateLimit = readRateLimitFromEnv('SUPPORT_TICKET_CREATE_LIMIT', {
  maxRequests: 15,
  windowMinutes: 10,
});

const supportTicketRateKey = (req: Request): string => {
  const customer = (req as CustomerAuthRequest).customer;

  if (customer) {
    return `customer:${customer.id}`;
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
};

const limitCreateSupportTicket = createRateLimiter({
  identifier: 'support_ticket_create',
  ...supportTicketCreateRateLimit,
  message: 'Too many support requests in a short time. Please wait and try again.',
  keyGenerator: supportTicketRateKey,
});

router.route('/tickets').post(attachCustomerIfPresent, limitCreateSupportTicket, createSupportTicket);

export default router;
