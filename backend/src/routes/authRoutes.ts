import express from 'express';
import {
  forgotCustomerPassword,
  getCurrentCustomer,
  loginCustomer,
  logoutCustomer,
  refreshCustomerSession,
  resendCustomerVerificationEmail,
  resetCustomerPassword,
  registerCustomer,
  updateCurrentCustomerProfile,
  verifyCustomerEmail,
} from '../controllers/authController.js';
import { requireCustomerAuth, type CustomerAuthRequest } from '../middleware/customerAuth.js';
import { createRateLimiter, readRateLimitFromEnv } from '../middleware/rateLimit.js';

const router = express.Router();

const loginRateLimit = readRateLimitFromEnv('AUTH_LOGIN_LIMIT', {
  maxRequests: 5,
  windowMinutes: 15,
});

const forgotPasswordRateLimit = readRateLimitFromEnv('AUTH_FORGOT_PASSWORD_LIMIT', {
  maxRequests: 5,
  windowMinutes: 15,
});

const verifyResendRateLimit = readRateLimitFromEnv('AUTH_VERIFY_RESEND_LIMIT', {
  maxRequests: 3,
  windowMinutes: 15,
});

const limitLogin = createRateLimiter({
  identifier: 'auth_login',
  ...loginRateLimit,
  message: 'Too many login attempts. Please wait and try again.',
});

const limitForgotPassword = createRateLimiter({
  identifier: 'auth_forgot_password',
  ...forgotPasswordRateLimit,
  message: 'Too many password reset attempts. Please wait and try again.',
});

const limitResendVerification = createRateLimiter({
  identifier: 'auth_verify_resend',
  ...verifyResendRateLimit,
  message: 'Too many verification email requests. Please wait and try again.',
  keyGenerator: (req) => {
    const customerId = (req as CustomerAuthRequest).customer?.id;
    return customerId || req.ip || req.socket.remoteAddress || 'unknown';
  },
});

router.route('/register').post(registerCustomer);
router.route('/login').post(limitLogin, loginCustomer);
router.route('/refresh').post(refreshCustomerSession);
router.route('/logout').post(logoutCustomer);
router.route('/verify-email/confirm').post(verifyCustomerEmail);
router.route('/verify-email/resend').post(requireCustomerAuth, limitResendVerification, resendCustomerVerificationEmail);
router.route('/forgot-password').post(limitForgotPassword, forgotCustomerPassword);
router.route('/reset-password').post(resetCustomerPassword);
router
  .route('/me')
  .get(requireCustomerAuth, getCurrentCustomer)
  .patch(requireCustomerAuth, updateCurrentCustomerProfile);

export default router;
