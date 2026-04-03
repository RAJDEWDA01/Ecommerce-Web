import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import env from '../config/env.js';
import { logAuditEvent } from '../utils/audit.js';

const uploadDirectory = path.resolve('uploads');
const maxUploadBytes = 5 * 1024 * 1024;
const remoteMimeToExtension = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
]);

class ImportImageError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ImportImageError';
    this.statusCode = statusCode;
  }
}

const sanitizeBaseName = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
};

const buildStoredImageUrl = (filename: string): string => `/uploads/${filename}`;

const resolveImportFileName = (sourceUrl: URL, extension: string): string => {
  const sourceBaseName = sanitizeBaseName(path.basename(sourceUrl.pathname, path.extname(sourceUrl.pathname)));
  const fallbackBaseName = 'remote-product';
  const timestamp = Date.now();
  const random = crypto.randomInt(100000000, 999999999);
  return `${sourceBaseName || fallbackBaseName}-${timestamp}-${random}${extension}`;
};

const validateRemoteImageUrl = (rawImageUrl: unknown): URL => {
  if (typeof rawImageUrl !== 'string' || !rawImageUrl.trim()) {
    throw new ImportImageError('Image URL is required');
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawImageUrl.trim());
  } catch {
    throw new ImportImageError('Image URL must be a valid absolute URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new ImportImageError('Image URL must use http:// or https://');
  }

  if (env.isProduction && parsedUrl.protocol !== 'https:') {
    throw new ImportImageError('Only https:// image URLs are allowed in production');
  }

  return parsedUrl;
};

export const uploadProductImage = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      await logAuditEvent(req, {
        action: 'uploads.product_image.create',
        outcome: 'failure',
        statusCode: 400,
        metadata: { reason: 'missing_file' },
      });
      res.status(400).json({ success: false, message: 'Image file is required' });
      return;
    }

    const imageUrl = buildStoredImageUrl(req.file.filename);

    await logAuditEvent(req, {
      action: 'uploads.product_image.create',
      outcome: 'success',
      statusCode: 201,
      resourceType: 'upload',
      resourceId: req.file.filename,
      metadata: {
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'uploads.product_image.create',
      outcome: 'failure',
      statusCode: 500,
      metadata: { reason: 'unexpected_error' },
    });
    console.error('Image upload error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload image' });
  }
};

export const importProductImageFromUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const imageUrl = validateRemoteImageUrl((req.body as { imageUrl?: unknown } | undefined)?.imageUrl);
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 15000);

    let response: globalThis.Response;
    try {
      response = await fetch(imageUrl.toString(), {
        method: 'GET',
        signal: abortController.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ImportImageError('Image download timed out');
      }

      throw new ImportImageError('Unable to fetch image from the given URL');
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new ImportImageError(`Image URL responded with HTTP ${response.status}`);
    }

    const contentTypeHeader = response.headers.get('content-type') ?? '';
    const mimeType = contentTypeHeader.split(';')[0]?.trim().toLowerCase();
    const extension = mimeType ? remoteMimeToExtension.get(mimeType) : undefined;

    if (!extension || !mimeType) {
      throw new ImportImageError('Only JPG, PNG, WEBP, and AVIF image URLs are supported');
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > maxUploadBytes) {
        throw new ImportImageError('Image must be 5MB or smaller');
      }
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.byteLength > maxUploadBytes) {
      throw new ImportImageError('Image must be 5MB or smaller');
    }

    await fs.mkdir(uploadDirectory, { recursive: true });

    const filename = resolveImportFileName(imageUrl, extension);
    await fs.writeFile(path.join(uploadDirectory, filename), buffer);

    const storedImageUrl = buildStoredImageUrl(filename);

    await logAuditEvent(req, {
      action: 'uploads.product_image.import',
      outcome: 'success',
      statusCode: 201,
      resourceType: 'upload',
      resourceId: filename,
      metadata: {
        sourceUrl: imageUrl.toString(),
        fileSize: buffer.byteLength,
        mimeType,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Image imported successfully',
      imageUrl: storedImageUrl,
      filename,
      size: buffer.byteLength,
      mimetype: mimeType,
      sourceUrl: imageUrl.toString(),
    });
  } catch (error) {
    const statusCode = error instanceof ImportImageError ? error.statusCode : 500;
    const message = error instanceof ImportImageError ? error.message : 'Failed to import image from URL';

    await logAuditEvent(req, {
      action: 'uploads.product_image.import',
      outcome: 'failure',
      statusCode,
      metadata: {
        reason: error instanceof ImportImageError ? 'validation_or_fetch_failed' : 'unexpected_error',
      },
    });

    if (!(error instanceof ImportImageError)) {
      console.error('Image import error:', error);
    }

    res.status(statusCode).json({ success: false, message });
  }
};
