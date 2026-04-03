import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import Product, { type IProductVariant } from '../models/Product.js';
import Order from '../models/Order.js';
import type { CustomerAuthRequest } from '../middleware/customerAuth.js';
import { logAuditEvent } from '../utils/audit.js';

interface ProductVariantInput {
  label?: string;
  size?: string;
  price?: number;
  stockQuantity?: number;
  sku?: string;
  imageUrl?: string | null;
  isDefault?: boolean;
}

interface ProductBody {
  name?: string;
  description?: string;
  price?: number;
  size?: string;
  imageUrl?: string;
  imageGallery?: unknown;
  variants?: unknown;
  stockQuantity?: number;
  sku?: string;
  isFeatured?: boolean;
}

interface ProductReviewBody {
  name?: string;
  rating?: number;
  title?: string;
  comment?: string;
}

interface BulkUpdateProductsBody {
  productIds?: unknown;
  updates?: {
    priceAdjustmentPercent?: unknown;
    stockAdjustment?: unknown;
    stockSetTo?: unknown;
    isFeatured?: unknown;
  };
}

interface ProductListQuery {
  page?: string;
  limit?: string;
  search?: string;
  featured?: string;
  inStock?: string;
  sortBy?: string;
  sortOrder?: string;
  includeMeta?: string;
}

interface ProductReviewQuery {
  page?: string;
  limit?: string;
}

interface LowStockQuery {
  threshold?: string;
  limit?: string;
}

interface PaginationMeta {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

type ProductSortField = 'createdAt' | 'price' | 'name' | 'stockQuantity' | 'ratingAverage';
type ProductSortOrder = 'asc' | 'desc';

const PRODUCT_SORT_FIELDS: ProductSortField[] = [
  'createdAt',
  'price',
  'name',
  'stockQuantity',
  'ratingAverage',
];

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_REVIEW_PAGE = 1;
const DEFAULT_REVIEW_LIMIT = 10;
const MAX_REVIEW_LIMIT = 50;
const REVIEW_TITLE_MAX_LENGTH = 120;
const REVIEW_COMMENT_MAX_LENGTH = 2000;

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeImageGallery = (value: unknown): string[] => {
  const asArray = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const deduped = new Set<string>();
  for (const entry of asArray) {
    const normalized = normalizeString(entry);
    if (normalized) {
      deduped.add(normalized);
    }
  }

  return [...deduped];
};

const normalizeVariantInput = (value: unknown): ProductVariantInput[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: ProductVariantInput[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const raw = entry as Record<string, unknown>;

    normalized.push({
      label: normalizeString(raw.label),
      size: normalizeString(raw.size),
      price: Number(raw.price),
      stockQuantity: Number(raw.stockQuantity),
      sku: normalizeString(raw.sku),
      imageUrl: normalizeString(raw.imageUrl) || null,
      isDefault: Boolean(raw.isDefault),
    });
  }

  return normalized;
};

const toProductVariants = (variants: ProductVariantInput[]): IProductVariant[] => {
  if (variants.length === 0) {
    return [];
  }

  let hasDefault = false;

  const normalized = variants.map((variant, index) => {
    const shouldBeDefault = variant.isDefault === true && !hasDefault;
    if (shouldBeDefault) {
      hasDefault = true;
    }

    return {
      label: variant.label || variant.size || `Variant ${index + 1}`,
      size: variant.size || variant.label || `Variant ${index + 1}`,
      price: Number(variant.price),
      stockQuantity: Number(variant.stockQuantity),
      sku: variant.sku || '',
      imageUrl: variant.imageUrl || null,
      isDefault: shouldBeDefault,
    } satisfies IProductVariant;
  });

  if (!hasDefault && normalized[0]) {
    normalized[0].isDefault = true;
  }

  return normalized;
};

const validateVariants = (variants: IProductVariant[]): { valid: boolean; message?: string } => {
  if (variants.length === 0) {
    return { valid: true };
  }

  const seenSkus = new Set<string>();
  let defaultCount = 0;

  for (const variant of variants) {
    if (!normalizeString(variant.label)) {
      return { valid: false, message: 'Each variant must have a label' };
    }

    if (!normalizeString(variant.size)) {
      return { valid: false, message: 'Each variant must have a size' };
    }

    if (!normalizeString(variant.sku)) {
      return { valid: false, message: 'Each variant must have a SKU' };
    }

    if (!Number.isFinite(variant.price) || variant.price < 0) {
      return { valid: false, message: `Variant ${variant.label} must have a non-negative price` };
    }

    if (!Number.isInteger(variant.stockQuantity) || variant.stockQuantity < 0) {
      return {
        valid: false,
        message: `Variant ${variant.label} must have a non-negative integer stock quantity`,
      };
    }

    const normalizedSku = variant.sku.toUpperCase();
    if (seenSkus.has(normalizedSku)) {
      return { valid: false, message: 'Variant SKUs must be unique inside the same product' };
    }
    seenSkus.add(normalizedSku);

    if (variant.isDefault) {
      defaultCount += 1;
    }
  }

  if (defaultCount > 1) {
    return { valid: false, message: 'Only one variant can be marked as default' };
  }

  return { valid: true };
};

interface PreparedProductPayload {
  name: string;
  description: string;
  price: number;
  size: string;
  imageUrl: string;
  imageGallery: string[];
  variants: IProductVariant[];
  stockQuantity: number;
  sku: string;
  isFeatured: boolean;
}

const prepareProductPayload = (
  body: ProductBody,
  existing?: {
    name: string;
    description: string;
    price: number;
    size: string;
    imageUrl: string;
    imageGallery: string[];
    variants: IProductVariant[];
    stockQuantity: number;
    sku: string;
    isFeatured: boolean;
  }
): { valid: boolean; message?: string; payload?: PreparedProductPayload } => {
  const name = normalizeString(body.name ?? existing?.name);
  const description = normalizeString(body.description ?? existing?.description);
  const baseImageUrl = normalizeString(body.imageUrl ?? existing?.imageUrl);
  const isFeatured = body.isFeatured ?? existing?.isFeatured ?? false;

  const imageGallery =
    body.imageGallery !== undefined
      ? normalizeImageGallery(body.imageGallery)
      : existing?.imageGallery ?? [];

  const rawVariants =
    body.variants !== undefined
      ? toProductVariants(normalizeVariantInput(body.variants))
      : existing?.variants ?? [];

  if (!name) {
    return { valid: false, message: 'Product name is required' };
  }

  if (!description) {
    return { valid: false, message: 'Product description is required' };
  }

  const variantsValidation = validateVariants(rawVariants);
  if (!variantsValidation.valid) {
    return variantsValidation;
  }

  let size = normalizeString(body.size ?? existing?.size);
  let sku = normalizeString(body.sku ?? existing?.sku);
  let price = Number(body.price ?? existing?.price);
  let stockQuantity = Number(body.stockQuantity ?? existing?.stockQuantity ?? 0);
  let imageUrl = baseImageUrl;

  if (rawVariants.length > 0) {
    const defaultVariant = rawVariants.find((variant) => variant.isDefault) ?? rawVariants[0];

    if (!defaultVariant) {
      return { valid: false, message: 'At least one valid variant is required' };
    }

    size = defaultVariant.size;
    sku = defaultVariant.sku;
    price = defaultVariant.price;
    stockQuantity = rawVariants.reduce((sum, variant) => sum + variant.stockQuantity, 0);
    imageUrl = imageUrl || normalizeString(defaultVariant.imageUrl) || imageGallery[0] || '';
  } else {
    if (!size) {
      return { valid: false, message: 'Product size is required' };
    }

    if (!sku) {
      return { valid: false, message: 'Product SKU is required' };
    }

    if (!Number.isFinite(price) || price < 0) {
      return { valid: false, message: 'Price must be a non-negative number' };
    }

    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
      return { valid: false, message: 'Stock quantity must be a non-negative integer' };
    }
  }

  if (!imageUrl) {
    return { valid: false, message: 'Product image URL is required' };
  }

  const mergedGallery = [imageUrl, ...imageGallery].filter(Boolean);
  const uniqueGallery = [...new Set(mergedGallery.map((entry) => normalizeString(entry)).filter(Boolean))];

  return {
    valid: true,
    payload: {
      name,
      description,
      price,
      size,
      imageUrl,
      imageGallery: uniqueGallery,
      variants: rawVariants,
      stockQuantity,
      sku,
      isFeatured: Boolean(isFeatured),
    },
  };
};

const parsePositiveInteger = (raw: unknown, fallback: number): number => {
  if (raw === undefined || raw === null) {
    return fallback;
  }

  const normalized = String(raw).trim();

  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const parseBooleanFilter = (raw: unknown): boolean | null => {
  if (raw === undefined || raw === null) {
    return null;
  }

  const normalized = String(raw).trim().toLowerCase();

  if (normalized === 'true' || normalized === '1') {
    return true;
  }

  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return null;
};

const parseSortBy = (raw: unknown): ProductSortField => {
  if (raw === undefined || raw === null) {
    return 'createdAt';
  }

  const normalized = String(raw).trim() as ProductSortField;
  return PRODUCT_SORT_FIELDS.includes(normalized) ? normalized : 'createdAt';
};

const parseSortOrder = (raw: unknown): ProductSortOrder => {
  if (raw === undefined || raw === null) {
    return 'desc';
  }

  const normalized = String(raw).trim().toLowerCase();
  return normalized === 'asc' ? 'asc' : 'desc';
};

const roundCurrency = (amount: number): number => Math.round(amount * 100) / 100;

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const shouldReturnPaginatedResponse = (query: ProductListQuery): boolean => {
  if (
    query.includeMeta !== undefined &&
    query.includeMeta !== null &&
    String(query.includeMeta).trim().toLowerCase() === 'true'
  ) {
    return true;
  }

  return Boolean(
    query.page ||
      query.limit ||
      query.search ||
      query.featured ||
      query.inStock ||
      query.sortBy ||
      query.sortOrder
  );
};

const buildPaginationMeta = (page: number, limit: number, totalCount: number): PaginationMeta => {
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / limit);

  return {
    page,
    limit,
    totalCount,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  };
};

const toSafeReviewCustomerName = (rawName: string, fallbackEmail: string): string => {
  const normalized = normalizeString(rawName);
  if (normalized) {
    return normalized.slice(0, 80);
  }

  const fromEmail = normalizeString(fallbackEmail.split('@')[0]);
  return fromEmail || 'Verified Customer';
};

const computeReviewStats = (
  reviews: Array<{ rating?: number }>
): { ratingAverage: number; ratingCount: number } => {
  const validRatings = reviews
    .map((review) => Number(review.rating))
    .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);

  const ratingCount = validRatings.length;
  if (ratingCount === 0) {
    return { ratingAverage: 0, ratingCount: 0 };
  }

  const total = validRatings.reduce((sum, rating) => sum + rating, 0);
  const ratingAverage = Math.round((total / ratingCount) * 10) / 10;

  return { ratingAverage, ratingCount };
};

export const getProducts = async (
  req: Request<unknown, unknown, unknown, ProductListQuery>,
  res: Response
) => {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const rawLimit = parsePositiveInteger(req.query.limit, DEFAULT_LIMIT);
    const limit = Math.min(rawLimit, MAX_LIMIT);
    const skip = (page - 1) * limit;

    const search = normalizeString(req.query.search);
    const featured = parseBooleanFilter(req.query.featured);
    const inStock = parseBooleanFilter(req.query.inStock);
    const sortBy = parseSortBy(req.query.sortBy);
    const sortOrder = parseSortOrder(req.query.sortOrder);

    const filters: Record<string, unknown> = {};

    if (featured !== null) {
      filters.isFeatured = featured;
    }

    if (inStock !== null) {
      filters.stockQuantity = inStock ? { $gt: 0 } : { $lte: 0 };
    }

    if (search) {
      const safeSearch = escapeRegExp(search);
      filters.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { description: { $regex: safeSearch, $options: 'i' } },
        { sku: { $regex: safeSearch, $options: 'i' } },
        { 'variants.sku': { $regex: safeSearch, $options: 'i' } },
        { 'variants.label': { $regex: safeSearch, $options: 'i' } },
      ];
    }

    const sortValue = sortOrder === 'asc' ? 1 : -1;
    const sortConfig: Record<string, 1 | -1> = { [sortBy]: sortValue };

    if (sortBy !== 'createdAt') {
      sortConfig.createdAt = -1;
    }

    const includeMeta = shouldReturnPaginatedResponse(req.query);

    if (!includeMeta) {
      const products = await Product.find(filters).sort(sortConfig).select('-reviews');
      res.status(200).json(products);
      return;
    }

    const [products, totalCount] = await Promise.all([
      Product.find(filters).sort(sortConfig).skip(skip).limit(limit).select('-reviews'),
      Product.countDocuments(filters),
    ]);

    res.status(200).json({
      success: true,
      count: products.length,
      products,
      pagination: buildPaginationMeta(page, limit, totalCount),
    });
  } catch {
    res.status(500).json({ message: 'Server Error fetching products' });
  }
};

export const getLowStockProducts = async (
  req: Request<unknown, unknown, unknown, LowStockQuery>,
  res: Response
): Promise<void> => {
  try {
    const threshold = Math.min(parsePositiveInteger(req.query.threshold, 10), 10000);
    const limit = Math.min(parsePositiveInteger(req.query.limit, 10), 100);

    const filter = { stockQuantity: { $lte: threshold } };

    const [products, totalLowStock, outOfStockCount] = await Promise.all([
      Product.find(filter)
        .sort({ stockQuantity: 1, updatedAt: -1 })
        .limit(limit)
        .select('_id name sku size stockQuantity updatedAt'),
      Product.countDocuments(filter),
      Product.countDocuments({ stockQuantity: { $lte: 0 } }),
    ]);

    res.status(200).json({
      success: true,
      threshold,
      count: products.length,
      totalLowStock,
      outOfStockCount,
      products,
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch low-stock products' });
  }
};

export const bulkUpdateProducts = async (
  req: Request<unknown, unknown, BulkUpdateProductsBody>,
  res: Response
): Promise<void> => {
  const rawProductIds = Array.isArray(req.body.productIds) ? req.body.productIds : [];
  const productIds = [...new Set(rawProductIds.map((id) => String(id).trim()).filter(Boolean))];

  if (productIds.length === 0) {
    await logAuditEvent(req, {
      action: 'catalog.product.bulk_update',
      outcome: 'failure',
      statusCode: 400,
      metadata: { reason: 'missing_product_ids' },
    });
    res.status(400).json({ success: false, message: 'productIds is required' });
    return;
  }

  if (productIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    await logAuditEvent(req, {
      action: 'catalog.product.bulk_update',
      outcome: 'failure',
      statusCode: 400,
      metadata: { reason: 'invalid_product_id' },
    });
    res.status(400).json({ success: false, message: 'All productIds must be valid' });
    return;
  }

  const updates =
    req.body.updates && typeof req.body.updates === 'object' ? req.body.updates : {};

  const hasPriceAdjustment = updates.priceAdjustmentPercent !== undefined;
  const hasStockAdjustment = updates.stockAdjustment !== undefined;
  const hasStockSetTo = updates.stockSetTo !== undefined;
  const hasFeaturedUpdate = updates.isFeatured !== undefined;

  if (!hasPriceAdjustment && !hasStockAdjustment && !hasStockSetTo && !hasFeaturedUpdate) {
    await logAuditEvent(req, {
      action: 'catalog.product.bulk_update',
      outcome: 'failure',
      statusCode: 400,
      metadata: { reason: 'missing_updates' },
    });
    res.status(400).json({ success: false, message: 'At least one update field is required' });
    return;
  }

  if (hasStockAdjustment && hasStockSetTo) {
    await logAuditEvent(req, {
      action: 'catalog.product.bulk_update',
      outcome: 'failure',
      statusCode: 400,
      metadata: { reason: 'conflicting_stock_updates' },
    });
    res.status(400).json({
      success: false,
      message: 'Use either stockAdjustment or stockSetTo, not both',
    });
    return;
  }

  let priceAdjustmentPercent = 0;
  if (hasPriceAdjustment) {
    const parsed = Number(updates.priceAdjustmentPercent);
    if (!Number.isFinite(parsed) || parsed < -95 || parsed > 500) {
      await logAuditEvent(req, {
        action: 'catalog.product.bulk_update',
        outcome: 'failure',
        statusCode: 400,
        metadata: { reason: 'invalid_price_adjustment' },
      });
      res.status(400).json({
        success: false,
        message: 'priceAdjustmentPercent must be between -95 and 500',
      });
      return;
    }
    priceAdjustmentPercent = parsed;
  }

  let stockAdjustment = 0;
  if (hasStockAdjustment) {
    const parsed = Number(updates.stockAdjustment);
    if (!Number.isInteger(parsed) || parsed < -100000 || parsed > 100000) {
      await logAuditEvent(req, {
        action: 'catalog.product.bulk_update',
        outcome: 'failure',
        statusCode: 400,
        metadata: { reason: 'invalid_stock_adjustment' },
      });
      res.status(400).json({
        success: false,
        message: 'stockAdjustment must be an integer between -100000 and 100000',
      });
      return;
    }
    stockAdjustment = parsed;
  }

  let stockSetTo = 0;
  if (hasStockSetTo) {
    const parsed = Number(updates.stockSetTo);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000000) {
      await logAuditEvent(req, {
        action: 'catalog.product.bulk_update',
        outcome: 'failure',
        statusCode: 400,
        metadata: { reason: 'invalid_stock_set_to' },
      });
      res.status(400).json({
        success: false,
        message: 'stockSetTo must be an integer between 0 and 1000000',
      });
      return;
    }
    stockSetTo = parsed;
  }

  let isFeatured = false;
  if (hasFeaturedUpdate) {
    if (typeof updates.isFeatured !== 'boolean') {
      await logAuditEvent(req, {
        action: 'catalog.product.bulk_update',
        outcome: 'failure',
        statusCode: 400,
        metadata: { reason: 'invalid_is_featured' },
      });
      res.status(400).json({ success: false, message: 'isFeatured must be a boolean' });
      return;
    }
    isFeatured = updates.isFeatured;
  }

  try {
    const products = await Product.find({ _id: { $in: productIds } });

    if (products.length === 0) {
      await logAuditEvent(req, {
        action: 'catalog.product.bulk_update',
        outcome: 'failure',
        statusCode: 404,
        metadata: { reason: 'products_not_found' },
      });
      res.status(404).json({ success: false, message: 'No products found for the selected ids' });
      return;
    }

    const updatesById = new Map<string, Record<string, unknown>>();

    for (const product of products) {
      const setPayload: Record<string, unknown> = {};

      if (hasPriceAdjustment) {
        const factor = 1 + priceAdjustmentPercent / 100;
        setPayload.price = roundCurrency(Math.max(0, product.price * factor));

        if (Array.isArray(product.variants) && product.variants.length > 0) {
          setPayload.variants = product.variants.map((variant) => ({
            label: variant.label,
            size: variant.size,
            price: roundCurrency(Math.max(0, variant.price * factor)),
            stockQuantity: variant.stockQuantity,
            sku: variant.sku,
            imageUrl: variant.imageUrl ?? null,
            isDefault: variant.isDefault,
          }));
        }
      }

      if (hasStockSetTo) {
        setPayload.stockQuantity = stockSetTo;
      } else if (hasStockAdjustment) {
        setPayload.stockQuantity = Math.max(0, product.stockQuantity + stockAdjustment);
      }

      if (hasFeaturedUpdate) {
        setPayload.isFeatured = isFeatured;
      }

      if (Object.keys(setPayload).length > 0) {
        updatesById.set(product._id.toString(), setPayload);
      }
    }

    if (updatesById.size === 0) {
      res.status(400).json({ success: false, message: 'No applicable updates to apply' });
      return;
    }

    await Product.bulkWrite(
      [...updatesById.entries()].map(([id, setPayload]) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: setPayload },
        },
      }))
    );

    await logAuditEvent(req, {
      action: 'catalog.product.bulk_update',
      outcome: 'success',
      statusCode: 200,
      metadata: {
        selectedCount: productIds.length,
        updatedCount: updatesById.size,
        ...(hasPriceAdjustment ? { priceAdjustmentPercent } : {}),
        ...(hasStockAdjustment ? { stockAdjustment } : {}),
        ...(hasStockSetTo ? { stockSetTo } : {}),
        ...(hasFeaturedUpdate ? { isFeatured } : {}),
      },
    });

    res.status(200).json({
      success: true,
      message: `Updated ${updatesById.size} product(s)`,
      updatedCount: updatesById.size,
    });
  } catch {
    await logAuditEvent(req, {
      action: 'catalog.product.bulk_update',
      outcome: 'failure',
      statusCode: 500,
      metadata: { reason: 'bulk_update_failed' },
    });
    res.status(500).json({ success: false, message: 'Failed to update selected products' });
  }
};

export const getProductById = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    const sortedReviews = [...product.reviews].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    res.status(200).json({
      ...product.toObject(),
      reviews: sortedReviews,
    });
  } catch {
    res.status(400).json({ message: 'Invalid product id' });
  }
};

export const createProduct = async (
  req: Request<unknown, unknown, ProductBody>,
  res: Response
): Promise<void> => {
  try {
    const prepared = prepareProductPayload(req.body);

    if (!prepared.valid || !prepared.payload) {
      await logAuditEvent(req, {
        action: 'catalog.product.create',
        outcome: 'failure',
        statusCode: 400,
        metadata: { reason: prepared.message ?? 'validation_failed' },
      });
      res.status(400).json({ message: prepared.message || 'Invalid product payload' });
      return;
    }

    const product = new Product({
      ...prepared.payload,
      reviews: [],
      ratingAverage: 0,
      ratingCount: 0,
    });

    const createdProduct = await product.save();
    await logAuditEvent(req, {
      action: 'catalog.product.create',
      outcome: 'success',
      statusCode: 201,
      resourceType: 'product',
      resourceId: createdProduct._id.toString(),
      metadata: {
        sku: createdProduct.sku,
      },
    });
    res.status(201).json(createdProduct);
  } catch (error: any) {
    if (error?.code === 11000) {
      await logAuditEvent(req, {
        action: 'catalog.product.create',
        outcome: 'failure',
        statusCode: 409,
        metadata: { reason: 'duplicate_sku' },
      });
      res.status(409).json({ message: 'SKU already exists. Please use a unique SKU.' });
      return;
    }

    await logAuditEvent(req, {
      action: 'catalog.product.create',
      outcome: 'failure',
      statusCode: 400,
      metadata: { reason: 'invalid_product_data' },
    });
    res.status(400).json({ message: 'Invalid product data', error: error.message });
  }
};

export const updateProduct = async (
  req: Request<{ id: string }, unknown, ProductBody>,
  res: Response
): Promise<void> => {
  try {
    const existing = await Product.findById(req.params.id);

    if (!existing) {
      await logAuditEvent(req, {
        action: 'catalog.product.update',
        outcome: 'failure',
        statusCode: 404,
        resourceType: 'product',
        resourceId: req.params.id,
        metadata: { reason: 'product_not_found' },
      });
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    const prepared = prepareProductPayload(req.body, {
      name: existing.name,
      description: existing.description,
      price: existing.price,
      size: existing.size,
      imageUrl: existing.imageUrl,
      imageGallery: existing.imageGallery ?? [],
      variants: existing.variants ?? [],
      stockQuantity: existing.stockQuantity,
      sku: existing.sku,
      isFeatured: existing.isFeatured,
    });

    if (!prepared.valid || !prepared.payload) {
      await logAuditEvent(req, {
        action: 'catalog.product.update',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'product',
        resourceId: existing._id.toString(),
        metadata: { reason: prepared.message ?? 'validation_failed' },
      });
      res.status(400).json({ message: prepared.message || 'Invalid product payload' });
      return;
    }

    existing.name = prepared.payload.name;
    existing.description = prepared.payload.description;
    existing.price = prepared.payload.price;
    existing.size = prepared.payload.size;
    existing.imageUrl = prepared.payload.imageUrl;
    existing.imageGallery = prepared.payload.imageGallery;
    existing.variants = prepared.payload.variants;
    existing.stockQuantity = prepared.payload.stockQuantity;
    existing.sku = prepared.payload.sku;
    existing.isFeatured = prepared.payload.isFeatured;

    const updatedProduct = await existing.save();
    await logAuditEvent(req, {
      action: 'catalog.product.update',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'product',
      resourceId: updatedProduct._id.toString(),
      metadata: {
        sku: updatedProduct.sku,
      },
    });
    res.status(200).json(updatedProduct);
  } catch (error: any) {
    if (error?.code === 11000) {
      await logAuditEvent(req, {
        action: 'catalog.product.update',
        outcome: 'failure',
        statusCode: 409,
        resourceType: 'product',
        resourceId: req.params.id,
        metadata: { reason: 'duplicate_sku' },
      });
      res.status(409).json({ message: 'SKU already exists. Please use a unique SKU.' });
      return;
    }

    await logAuditEvent(req, {
      action: 'catalog.product.update',
      outcome: 'failure',
      statusCode: 400,
      resourceType: 'product',
      resourceId: req.params.id,
      metadata: { reason: 'update_failed' },
    });
    res.status(400).json({ message: 'Failed to update product', error: error.message });
  }
};

export const deleteProduct = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const deletedProduct = await Product.findByIdAndDelete(req.params.id);

    if (!deletedProduct) {
      await logAuditEvent(req, {
        action: 'catalog.product.delete',
        outcome: 'failure',
        statusCode: 404,
        resourceType: 'product',
        resourceId: req.params.id,
        metadata: { reason: 'product_not_found' },
      });
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    await logAuditEvent(req, {
      action: 'catalog.product.delete',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'product',
      resourceId: deletedProduct._id.toString(),
      metadata: {
        sku: deletedProduct.sku,
      },
    });
    res.status(200).json({
      success: true,
      message: 'Product deleted successfully',
      id: deletedProduct._id,
    });
  } catch {
    await logAuditEvent(req, {
      action: 'catalog.product.delete',
      outcome: 'failure',
      statusCode: 400,
      resourceType: 'product',
      resourceId: req.params.id,
      metadata: { reason: 'invalid_product_id' },
    });
    res.status(400).json({ message: 'Invalid product id' });
  }
};

export const getProductReviews = async (
  req: Request<{ id: string }, unknown, unknown, ProductReviewQuery>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid product id' });
      return;
    }

    const product = await Product.findById(id).select('reviews ratingAverage ratingCount name');

    if (!product) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    const page = parsePositiveInteger(req.query.page, DEFAULT_REVIEW_PAGE);
    const rawLimit = parsePositiveInteger(req.query.limit, DEFAULT_REVIEW_LIMIT);
    const limit = Math.min(rawLimit, MAX_REVIEW_LIMIT);
    const skip = (page - 1) * limit;

    const reviews = [...product.reviews].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const paginated = reviews.slice(skip, skip + limit);

    res.status(200).json({
      success: true,
      productId: product._id,
      productName: product.name,
      ratingAverage: product.ratingAverage,
      ratingCount: product.ratingCount,
      reviews: paginated,
      pagination: buildPaginationMeta(page, limit, reviews.length),
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch product reviews' });
  }
};

export const createProductReview = async (
  req: Request<{ id: string }, unknown, ProductReviewBody>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid product id' });
      return;
    }

    const rating = Number(req.body.rating);
    const title = normalizeString(req.body.title);
    const comment = normalizeString(req.body.comment);
    const rawName = normalizeString(req.body.name);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ success: false, message: 'rating must be an integer between 1 and 5' });
      return;
    }

    if (!comment) {
      res.status(400).json({ success: false, message: 'comment is required' });
      return;
    }

    if (title.length > REVIEW_TITLE_MAX_LENGTH) {
      res.status(400).json({
        success: false,
        message: `title must be ${REVIEW_TITLE_MAX_LENGTH} characters or less`,
      });
      return;
    }

    if (comment.length > REVIEW_COMMENT_MAX_LENGTH) {
      res.status(400).json({
        success: false,
        message: `comment must be ${REVIEW_COMMENT_MAX_LENGTH} characters or less`,
      });
      return;
    }

    const product = await Product.findById(id);

    if (!product) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    const customerId = (req as CustomerAuthRequest).customer?.id;
    const customerEmail = (req as CustomerAuthRequest).customer?.email ?? '';
    const hasCustomer = Boolean(customerId && mongoose.Types.ObjectId.isValid(customerId));

    if (!hasCustomer && !rawName) {
      res.status(400).json({
        success: false,
        message: 'name is required for guest reviews',
      });
      return;
    }

    if (hasCustomer) {
      const customerObjectId = new mongoose.Types.ObjectId(customerId);
      const alreadyReviewed = product.reviews.some(
        (review) =>
          review.customer instanceof mongoose.Types.ObjectId &&
          review.customer.toString() === customerObjectId.toString()
      );

      if (alreadyReviewed) {
        res.status(409).json({
          success: false,
          message: 'You have already submitted a review for this product',
        });
        return;
      }
    }

    let isVerifiedPurchase = false;

    if (hasCustomer) {
      const customerObjectId = new mongoose.Types.ObjectId(customerId);
      const purchased = await Order.exists({
        customer: customerObjectId,
        paymentStatus: 'paid',
        'items.product': product._id,
      });
      isVerifiedPurchase = Boolean(purchased);
    }

    const customerName = toSafeReviewCustomerName(rawName, customerEmail);
    const nextReview = {
      customer:
        hasCustomer && customerId ? new mongoose.Types.ObjectId(customerId) : null,
      customerName,
      rating,
      title: title || null,
      comment,
      isVerifiedPurchase,
      createdAt: new Date(),
    };

    product.reviews.unshift(nextReview);

    const { ratingAverage, ratingCount } = computeReviewStats(product.reviews);
    product.ratingAverage = ratingAverage;
    product.ratingCount = ratingCount;
    await product.save();

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      review: nextReview,
      ratingAverage: product.ratingAverage,
      ratingCount: product.ratingCount,
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to submit review' });
  }
};
