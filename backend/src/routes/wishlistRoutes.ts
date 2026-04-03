import express from 'express';
import {
  addWishlistItem,
  clearWishlist,
  getWishlist,
  removeWishlistItem,
} from '../controllers/wishlistController.js';
import { requireCustomerAuth } from '../middleware/customerAuth.js';

const router = express.Router();

router.route('/').get(requireCustomerAuth, getWishlist).delete(requireCustomerAuth, clearWishlist);
router.route('/items').post(requireCustomerAuth, addWishlistItem);
router.route('/items/:productId').delete(requireCustomerAuth, removeWishlistItem);

export default router;
