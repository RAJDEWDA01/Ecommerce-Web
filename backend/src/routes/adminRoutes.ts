import express from 'express';
import { adminLogin } from '../controllers/adminAuthController.js';
import { getLowStockProducts } from '../controllers/productController.js';
import {
  getAdminNotificationDeliveryAnalytics,
  getAdminNotificationDeliveries,
  getAdminNotificationRetentionHealth,
  getAdminNotificationRetryHealth,
  runAdminNotificationRetentionNowHandler,
  runAdminNotificationRetryNowHandler,
} from '../controllers/notificationController.js';
import {
  exportAuditLogsCsv,
  getAuditAlertStatus,
  getAuditAlertNotifierHealth,
  getAuditAnalytics,
  getAuditLogs,
  getAuditRetentionHealth,
  runAuditAlertNotifierNowHandler,
  runAuditRetentionNowHandler,
} from '../controllers/auditController.js';
import {
  bulkUpdateCouponStatus,
  createCoupon,
  deleteCoupon,
  getCouponAnalytics,
  getCoupons,
  updateCoupon,
} from '../controllers/couponController.js';
import {
  getFeedback,
  updateFeedbackStatus,
} from '../controllers/feedbackController.js';
import {
  addSupportTicketNote,
  getSupportTickets,
  updateSupportTicketStatus,
} from '../controllers/supportController.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/authorization.js';

const router = express.Router();

router.route('/login').post(adminLogin);
router.route('/audit-logs').get(requireAdminAuth, requirePermission('audit:read'), getAuditLogs);
router
  .route('/audit-logs/analytics')
  .get(requireAdminAuth, requirePermission('audit:read'), getAuditAnalytics);
router
  .route('/audit-alerts/status')
  .get(requireAdminAuth, requirePermission('audit:read'), getAuditAlertStatus);
router
  .route('/audit-alerts/notifier/status')
  .get(requireAdminAuth, requirePermission('audit:read'), getAuditAlertNotifierHealth);
router
  .route('/audit-alerts/notifier/run')
  .post(requireAdminAuth, requirePermission('audit:read'), runAuditAlertNotifierNowHandler);
router
  .route('/audit-logs/export')
  .get(requireAdminAuth, requirePermission('audit:read'), exportAuditLogsCsv);
router
  .route('/audit-retention/status')
  .get(requireAdminAuth, requirePermission('audit:read'), getAuditRetentionHealth);
router
  .route('/audit-retention/run')
  .post(requireAdminAuth, requirePermission('audit:read'), runAuditRetentionNowHandler);
router
  .route('/notification-deliveries')
  .get(requireAdminAuth, requirePermission('audit:read'), getAdminNotificationDeliveries);
router
  .route('/notification-deliveries/analytics')
  .get(requireAdminAuth, requirePermission('audit:read'), getAdminNotificationDeliveryAnalytics);
router
  .route('/notification-deliveries/retry/status')
  .get(requireAdminAuth, requirePermission('audit:read'), getAdminNotificationRetryHealth);
router
  .route('/notification-deliveries/retry/run')
  .post(requireAdminAuth, requirePermission('audit:read'), runAdminNotificationRetryNowHandler);
router
  .route('/notification-deliveries/retention/status')
  .get(requireAdminAuth, requirePermission('audit:read'), getAdminNotificationRetentionHealth);
router
  .route('/notification-deliveries/retention/run')
  .post(requireAdminAuth, requirePermission('audit:read'), runAdminNotificationRetentionNowHandler);
router
  .route('/coupons')
  .get(requireAdminAuth, requirePermission('catalog:write'), getCoupons)
  .post(requireAdminAuth, requirePermission('catalog:write'), createCoupon);
router
  .route('/coupons/analytics')
  .get(requireAdminAuth, requirePermission('catalog:write'), getCouponAnalytics);
router
  .route('/coupons/bulk-status')
  .patch(requireAdminAuth, requirePermission('catalog:write'), bulkUpdateCouponStatus);
router
  .route('/coupons/:id')
  .patch(requireAdminAuth, requirePermission('catalog:write'), updateCoupon)
  .delete(requireAdminAuth, requirePermission('catalog:write'), deleteCoupon);
router
  .route('/support-tickets')
  .get(requireAdminAuth, requirePermission('orders:read:any'), getSupportTickets);
router
  .route('/support-tickets/:id/status')
  .patch(requireAdminAuth, requirePermission('orders:read:any'), updateSupportTicketStatus);
router
  .route('/support-tickets/:id/notes')
  .post(requireAdminAuth, requirePermission('orders:read:any'), addSupportTicketNote);
router
  .route('/feedback')
  .get(requireAdminAuth, requirePermission('orders:read:any'), getFeedback);
router
  .route('/feedback/:id/status')
  .patch(requireAdminAuth, requirePermission('orders:read:any'), updateFeedbackStatus);
router
  .route('/inventory/low-stock')
  .get(requireAdminAuth, requirePermission('catalog:write'), getLowStockProducts);

export default router;
