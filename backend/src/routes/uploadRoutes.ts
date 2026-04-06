import express from 'express';
import { importProductImageFromUrl, uploadProductImage } from '../controllers/uploadController.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/authorization.js';
import multer from 'multer';
import { uploadMiddleware } from '../services/storage.js';

const router = express.Router();

router.post('/product-image', requireAdminAuth, requirePermission('uploads:write'), (req, res, next) => {
  uploadMiddleware.single('image')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ success: false, message: 'Image must be 5MB or smaller' });
        return;
      }

      res.status(400).json({ success: false, message: error.message });
      return;
    }

    if (error) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }

    next();
  });
}, uploadProductImage);

router.post(
  '/product-image-url',
  requireAdminAuth,
  requirePermission('uploads:write'),
  importProductImageFromUrl
);

export default router;
