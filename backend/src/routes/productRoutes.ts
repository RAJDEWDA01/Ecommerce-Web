import express from 'express';
import {
  getProducts,
  bulkUpdateProducts,
  createProduct,
  getProductById,
  updateProduct,
  deleteProduct,
  getProductReviews,
  createProductReview,
} from '../controllers/productController.js';
import { attachCustomerIfPresent } from '../middleware/customerAuth.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/authorization.js';

const router = express.Router();


router.route('/').get(getProducts);


router.route('/').post(requireAdminAuth, requirePermission('catalog:write'), createProduct);
router
  .route('/bulk')
  .patch(requireAdminAuth, requirePermission('catalog:write'), bulkUpdateProducts);
router
  .route('/:id')
  .get(getProductById)
  .put(requireAdminAuth, requirePermission('catalog:write'), updateProduct)
  .delete(requireAdminAuth, requirePermission('catalog:write'), deleteProduct);
router
  .route('/:id/reviews')
  .get(getProductReviews)
  .post(attachCustomerIfPresent, createProductReview);

export default router;
