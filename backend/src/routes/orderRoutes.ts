import express from 'express';
import {
  createOrder,
  exportRefundTrendCsv,
  exportRefundsCsv,
  getRefundAnalytics,
  getOrderById,
  getOrders,
  getMyOrders,
  requestOrderCancellation,
  reviewOrderCancellation,
  updateOrderRefund,
  updateOrderStatus,
} from '../controllers/orderController.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { attachAuthIfPresent } from '../middleware/authContext.js';
import { attachCustomerIfPresent, requireCustomerAuth } from '../middleware/customerAuth.js';
import { requirePermission } from '../middleware/authorization.js';

const router = express.Router();

router
  .route('/')
  .get(requireAdminAuth, requirePermission('orders:read:any'), getOrders)
  .post(attachCustomerIfPresent, createOrder);
router
  .route('/refunds/export')
  .get(requireAdminAuth, requirePermission('orders:read:any'), exportRefundsCsv);
router
  .route('/refunds/analytics/export')
  .get(requireAdminAuth, requirePermission('orders:read:any'), exportRefundTrendCsv);
router
  .route('/refunds/analytics')
  .get(requireAdminAuth, requirePermission('orders:read:any'), getRefundAnalytics);
router.route('/my-orders').get(requireCustomerAuth, getMyOrders);
router.route('/:id/cancellation-request').post(requireCustomerAuth, requestOrderCancellation);
router
  .route('/:id/cancellation-request/decision')
  .patch(requireAdminAuth, requirePermission('orders:write:status'), reviewOrderCancellation);
router
  .route('/:id/refund')
  .patch(requireAdminAuth, requirePermission('orders:write:status'), updateOrderRefund);
router.route('/:id').get(attachAuthIfPresent, getOrderById);
router
  .route('/:id/status')
  .patch(requireAdminAuth, requirePermission('orders:write:status'), updateOrderStatus);

export default router;
