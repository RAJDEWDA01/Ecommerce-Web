import express from 'express';
import { validateCoupon } from '../controllers/couponController.js';
import { attachCustomerIfPresent } from '../middleware/customerAuth.js';

const router = express.Router();

router.route('/validate').post(attachCustomerIfPresent, validateCoupon);

export default router;
