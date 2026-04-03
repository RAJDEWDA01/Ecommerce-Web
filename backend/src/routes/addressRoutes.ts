import express from 'express';
import {
  createCustomerAddress,
  deleteCustomerAddress,
  listCustomerAddresses,
  setCustomerDefaultAddress,
  updateCustomerAddress,
} from '../controllers/addressController.js';
import { requireCustomerAuth } from '../middleware/customerAuth.js';

const router = express.Router();

router.use(requireCustomerAuth);
router.route('/').get(listCustomerAddresses).post(createCustomerAddress);
router.route('/:id').patch(updateCustomerAddress).delete(deleteCustomerAddress);
router.route('/:id/default').patch(setCustomerDefaultAddress);

export default router;
