import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { importProductImageFromUrl, uploadProductImage } from '../controllers/uploadController.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/authorization.js';

const router = express.Router();

const uploadDirectory = path.resolve('uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDirectory);
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const safeBase = path
      .basename(file.originalname, extension)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 50);

    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e9);
    cb(null, `${safeBase || 'product'}-${timestamp}-${random}${extension}`);
  },
});

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
]);

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      cb(new Error('Only JPG, PNG, WEBP, and AVIF images are allowed'));
      return;
    }

    cb(null, true);
  },
});

router.post('/product-image', requireAdminAuth, requirePermission('uploads:write'), (req, res, next) => {
  upload.single('image')(req, res, (error) => {
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
