import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import env from '../config/env.js';

const uploadDirectory = path.resolve('uploads');
const maxUploadBytes = 5 * 1024 * 1024;
const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
]);

const sanitizeBaseName = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
};

const buildFilename = (originalName: string): string => {
  const extension = path.extname(originalName).toLowerCase();
  const safeBase = sanitizeBaseName(path.basename(originalName, extension));
  const timestamp = Date.now();
  const random = crypto.randomInt(100000000, 999999999);
  return `${safeBase || 'product'}-${timestamp}-${random}${extension || '.jpg'}`;
};

export const isCloudinaryDriver = env.uploadDriver === 'cloudinary';

if (isCloudinaryDriver) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName ?? '',
    api_key: env.cloudinary.apiKey ?? '',
    api_secret: env.cloudinary.apiSecret ?? '',
    secure: true,
  });
}

export const uploadMiddleware = multer({
  storage: isCloudinaryDriver
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (_req, _file, cb) => {
          fs.mkdir(uploadDirectory, { recursive: true })
            .then(() => cb(null, uploadDirectory))
            .catch((error) => cb(error as Error, uploadDirectory));
        },
        filename: (_req, file, cb) => {
          cb(null, buildFilename(file.originalname));
        },
      }),
  limits: { fileSize: maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      cb(new Error('Only JPG, PNG, WEBP, and AVIF images are allowed'));
      return;
    }

    cb(null, true);
  },
});

export type StoredImage = {
  url: string;
  size: number;
  mimetype: string;
  filename?: string;
  publicId?: string;
};

export const buildStoredImageUrl = (filename: string): string => `/uploads/${filename}`;

export const storeImageBuffer = async (
  buffer: Buffer,
  originalName: string,
  mimetype: string
): Promise<StoredImage> => {
  if (buffer.byteLength > maxUploadBytes) {
    throw new Error('Image must be 5MB or smaller');
  }

  if (isCloudinaryDriver) {
    const publicIdBase = `${env.cloudinary.folder}/${sanitizeBaseName(path.basename(originalName, path.extname(originalName))) || 'product'}`;

    const result = await new Promise<{
      secure_url: string;
      public_id: string;
      bytes: number;
      format?: string;
    }>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: env.cloudinary.folder,
          public_id: publicIdBase,
          overwrite: false,
          resource_type: 'image',
          unique_filename: true,
        },
        (error, uploadResult) => {
          if (error || !uploadResult) {
            reject(error ?? new Error('Cloudinary upload failed'));
            return;
          }

          resolve({
            secure_url: uploadResult.secure_url,
            public_id: uploadResult.public_id,
            bytes: uploadResult.bytes,
            format: uploadResult.format ?? undefined,
          });
        }
      );

      uploadStream.end(buffer);
    });

    return {
      url: result.secure_url,
      size: result.bytes,
      mimetype,
      publicId: result.public_id,
    };
  }

  await fs.mkdir(uploadDirectory, { recursive: true });
  const filename = buildFilename(originalName);
  await fs.writeFile(path.join(uploadDirectory, filename), buffer);

  return {
    url: buildStoredImageUrl(filename),
    size: buffer.byteLength,
    mimetype,
    filename,
  };
};

export const getUploadLimits = () => ({
  maxUploadBytes,
  allowedMimeTypes,
});
