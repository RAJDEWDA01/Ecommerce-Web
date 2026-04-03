import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import Coupon, { type CouponDiscountType, type ICoupon } from '../models/Coupon.js';
import type { CustomerAuthRequest } from '../middleware/customerAuth.js';
import { logAuditEvent } from '../utils/audit.js';
import { validateCouponForOrder } from '../services/couponService.js';

interface ValidateCouponBody {
  code?: string;
  subtotal?: number;
}

interface CouponBody {
  code?: string;
  description?: string;
  discountType?: CouponDiscountType;
  discountValue?: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number | null;
  isActive?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  perUserLimit?: number | null;
}

interface CouponListQuery {
  page?: string;
  limit?: string;
  search?: string;
  isActive?: string;
}

interface BulkCouponStatusBody {
  ids?: string[];
  isActive?: boolean;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

const normalizeCode = (raw: unknown): string => {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
};

const normalizeOptionalString = (raw: unknown): string | null => {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
};

const parseNullableDate = (raw: unknown): Date | null | 'invalid' => {
  if (raw === undefined || raw === null) {
    return null;
  }

  if (typeof raw !== 'string') {
    return 'invalid';
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return 'invalid';
  }

  return parsed;
};

const parseNullablePositiveInteger = (raw: unknown): number | null | 'invalid' => {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 'invalid';
  }

  return parsed;
};

const parseNonNegativeNumber = (raw: unknown): number | 'invalid' => {
  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 'invalid';
  }

  return parsed;
};

const sanitizeCoupon = (coupon: ICoupon) => {
  return {
    id: coupon._id,
    code: coupon.code,
    description: coupon.description ?? null,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    minOrderAmount: coupon.minOrderAmount,
    maxDiscountAmount: coupon.maxDiscountAmount ?? null,
    isActive: coupon.isActive,
    startsAt: coupon.startsAt ?? null,
    endsAt: coupon.endsAt ?? null,
    usageLimit: coupon.usageLimit ?? null,
    usedCount: coupon.usedCount,
    perUserLimit: coupon.perUserLimit ?? null,
    createdAt: coupon.createdAt,
    updatedAt: coupon.updatedAt,
  };
};

const validateCouponPayload = (payload: CouponBody): { valid: boolean; message?: string } => {
  const code = normalizeCode(payload.code);

  if (!code) {
    return { valid: false, message: 'Coupon code is required' };
  }

  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    return { valid: false, message: 'Coupon code must be 3-32 chars: A-Z, 0-9, _, -' };
  }

  if (payload.discountType !== 'percentage' && payload.discountType !== 'fixed') {
    return { valid: false, message: 'discountType must be one of: percentage, fixed' };
  }

  const discountValue = parseNonNegativeNumber(payload.discountValue);

  if (discountValue === 'invalid' || discountValue <= 0) {
    return { valid: false, message: 'discountValue must be a positive number' };
  }

  const minOrderAmount = parseNonNegativeNumber(payload.minOrderAmount ?? 0);

  if (minOrderAmount === 'invalid') {
    return { valid: false, message: 'minOrderAmount must be a non-negative number' };
  }

  const maxDiscountAmount =
    payload.maxDiscountAmount === null || payload.maxDiscountAmount === undefined
      ? null
      : parseNonNegativeNumber(payload.maxDiscountAmount);

  if (maxDiscountAmount === 'invalid') {
    return { valid: false, message: 'maxDiscountAmount must be a non-negative number' };
  }

  if (payload.discountType === 'percentage' && discountValue > 100) {
    return { valid: false, message: 'For percentage coupons, discountValue cannot exceed 100' };
  }

  const startsAt = parseNullableDate(payload.startsAt);
  const endsAt = parseNullableDate(payload.endsAt);

  if (startsAt === 'invalid' || endsAt === 'invalid') {
    return { valid: false, message: 'startsAt/endsAt must be valid date strings' };
  }

  if (startsAt && endsAt && startsAt.getTime() > endsAt.getTime()) {
    return { valid: false, message: 'startsAt cannot be later than endsAt' };
  }

  const usageLimit = parseNullablePositiveInteger(payload.usageLimit);
  const perUserLimit = parseNullablePositiveInteger(payload.perUserLimit);

  if (usageLimit === 'invalid' || perUserLimit === 'invalid') {
    return { valid: false, message: 'usageLimit/perUserLimit must be positive integers or null' };
  }

  if (typeof usageLimit === 'number' && typeof perUserLimit === 'number' && perUserLimit > usageLimit) {
    return { valid: false, message: 'perUserLimit cannot be greater than usageLimit' };
  }

  return { valid: true };
};

const buildCouponUpdatePayload = (payload: CouponBody): Record<string, unknown> => {
  const next: Record<string, unknown> = {};

  if (payload.code !== undefined) {
    next.code = normalizeCode(payload.code);
  }

  if (payload.description !== undefined) {
    next.description = normalizeOptionalString(payload.description);
  }

  if (payload.discountType !== undefined) {
    next.discountType = payload.discountType;
  }

  if (payload.discountValue !== undefined) {
    next.discountValue = Number(payload.discountValue);
  }

  if (payload.minOrderAmount !== undefined) {
    next.minOrderAmount = Number(payload.minOrderAmount);
  }

  if (payload.maxDiscountAmount !== undefined) {
    next.maxDiscountAmount = payload.maxDiscountAmount === null ? null : Number(payload.maxDiscountAmount);
  }

  if (payload.isActive !== undefined) {
    next.isActive = Boolean(payload.isActive);
  }

  if (payload.startsAt !== undefined) {
    next.startsAt = payload.startsAt ? new Date(payload.startsAt) : null;
  }

  if (payload.endsAt !== undefined) {
    next.endsAt = payload.endsAt ? new Date(payload.endsAt) : null;
  }

  if (payload.usageLimit !== undefined) {
    next.usageLimit = payload.usageLimit === null ? null : Number(payload.usageLimit);
  }

  if (payload.perUserLimit !== undefined) {
    next.perUserLimit = payload.perUserLimit === null ? null : Number(payload.perUserLimit);
  }

  return next;
};

export const validateCoupon = async (
  req: Request<unknown, unknown, ValidateCouponBody>,
  res: Response
): Promise<void> => {
  try {
    const code = normalizeCode(req.body.code);
    const subtotal = Number(req.body.subtotal);
    const authReq = req as CustomerAuthRequest;
    const customerObjectId =
      authReq.customer?.id && mongoose.Types.ObjectId.isValid(authReq.customer.id)
        ? new mongoose.Types.ObjectId(authReq.customer.id)
        : null;

    const validation = await validateCouponForOrder({
      code,
      subtotal,
      customerId: customerObjectId,
    });

    if (!validation.valid) {
      res.status(400).json({
        success: false,
        message: validation.message,
        coupon: {
          code: validation.normalizedCode,
          discountAmount: 0,
          finalAmount: subtotal,
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: validation.message,
      coupon: {
        code: validation.normalizedCode,
        discountType: validation.coupon.discountType,
        discountValue: validation.coupon.discountValue,
        discountAmount: validation.discountAmount,
        finalAmount: Math.max(0, Math.round((subtotal - validation.discountAmount) * 100) / 100),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to validate coupon' });
  }
};

export const getCoupons = async (
  req: Request<unknown, unknown, unknown, CouponListQuery>,
  res: Response
): Promise<void> => {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInteger(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;

    const filters: Record<string, unknown> = {};
    const search = req.query.search?.trim();

    if (search) {
      filters.$or = [{ code: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];
    }

    if (typeof req.query.isActive === 'string' && req.query.isActive.trim()) {
      const normalized = req.query.isActive.trim().toLowerCase();

      if (normalized === 'true' || normalized === '1') {
        filters.isActive = true;
      } else if (normalized === 'false' || normalized === '0') {
        filters.isActive = false;
      }
    }

    const [coupons, totalCount] = await Promise.all([
      Coupon.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Coupon.countDocuments(filters),
    ]);

    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      coupons: coupons.map(sanitizeCoupon),
      count: coupons.length,
      totalCount,
      pagination: {
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1 && totalPages > 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch coupons' });
  }
};

export const createCoupon = async (
  req: Request<unknown, unknown, CouponBody>,
  res: Response
): Promise<void> => {
  try {
    const validation = validateCouponPayload(req.body);

    if (!validation.valid) {
      await logAuditEvent(req, {
        action: 'marketing.coupon.create',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'coupon',
        metadata: { reason: validation.message ?? 'validation_failed' },
      });
      res.status(400).json({ success: false, message: validation.message });
      return;
    }

    const adminId = (req as Request & { admin?: { id: string } }).admin?.id;
    const discountType = req.body.discountType as CouponDiscountType;
    const discountValue = Number(req.body.discountValue);
    const minOrderAmount = Number(req.body.minOrderAmount ?? 0);
    const usageLimit =
      req.body.usageLimit === undefined || req.body.usageLimit === null
        ? null
        : Number(req.body.usageLimit);
    const perUserLimit =
      req.body.perUserLimit === undefined || req.body.perUserLimit === null
        ? null
        : Number(req.body.perUserLimit);

    const coupon = await Coupon.create({
      code: normalizeCode(req.body.code),
      description: normalizeOptionalString(req.body.description),
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscountAmount:
        req.body.maxDiscountAmount === null || req.body.maxDiscountAmount === undefined
          ? null
          : Number(req.body.maxDiscountAmount),
      isActive: req.body.isActive === undefined ? true : Boolean(req.body.isActive),
      startsAt: req.body.startsAt ? new Date(req.body.startsAt) : null,
      endsAt: req.body.endsAt ? new Date(req.body.endsAt) : null,
      usageLimit,
      perUserLimit,
      createdBy:
        adminId && mongoose.Types.ObjectId.isValid(adminId)
          ? new mongoose.Types.ObjectId(adminId)
          : null,
    });

    await logAuditEvent(req, {
      action: 'marketing.coupon.create',
      outcome: 'success',
      statusCode: 201,
      resourceType: 'coupon',
      resourceId: coupon._id.toString(),
      metadata: { code: coupon.code },
    });

    res.status(201).json({ success: true, coupon: sanitizeCoupon(coupon) });
  } catch (error: unknown) {
    const maybeError = error as { code?: number };

    if (maybeError.code === 11000) {
      await logAuditEvent(req, {
        action: 'marketing.coupon.create',
        outcome: 'failure',
        statusCode: 409,
        resourceType: 'coupon',
        metadata: { reason: 'duplicate_code' },
      });
      res.status(409).json({ success: false, message: 'Coupon code already exists' });
      return;
    }

    await logAuditEvent(req, {
      action: 'marketing.coupon.create',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'coupon',
      metadata: { reason: 'unexpected_error' },
    });
    res.status(500).json({ success: false, message: 'Failed to create coupon' });
  }
};

export const updateCoupon = async (
  req: Request<{ id: string }, unknown, CouponBody>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid coupon id' });
      return;
    }

    const existing = await Coupon.findById(id);

    if (!existing) {
      res.status(404).json({ success: false, message: 'Coupon not found' });
      return;
    }

    const nextPayload: CouponBody = {
      code: req.body.code ?? existing.code,
      description: req.body.description ?? existing.description ?? '',
      discountType: req.body.discountType ?? existing.discountType,
      discountValue: req.body.discountValue ?? existing.discountValue,
      minOrderAmount: req.body.minOrderAmount ?? existing.minOrderAmount,
      maxDiscountAmount: req.body.maxDiscountAmount ?? existing.maxDiscountAmount ?? null,
      isActive: req.body.isActive ?? existing.isActive,
      startsAt:
        req.body.startsAt === undefined
          ? existing.startsAt
            ? existing.startsAt.toISOString()
            : null
          : req.body.startsAt,
      endsAt:
        req.body.endsAt === undefined
          ? existing.endsAt
            ? existing.endsAt.toISOString()
            : null
          : req.body.endsAt,
      usageLimit: req.body.usageLimit ?? existing.usageLimit ?? null,
      perUserLimit: req.body.perUserLimit ?? existing.perUserLimit ?? null,
    };

    const validation = validateCouponPayload(nextPayload);

    if (!validation.valid) {
      await logAuditEvent(req, {
        action: 'marketing.coupon.update',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'coupon',
        resourceId: existing._id.toString(),
        metadata: { reason: validation.message ?? 'validation_failed' },
      });
      res.status(400).json({ success: false, message: validation.message });
      return;
    }

    const updated = await Coupon.findByIdAndUpdate(id, buildCouponUpdatePayload(req.body), {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      res.status(404).json({ success: false, message: 'Coupon not found' });
      return;
    }

    await logAuditEvent(req, {
      action: 'marketing.coupon.update',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'coupon',
      resourceId: updated._id.toString(),
      metadata: { code: updated.code },
    });

    res.status(200).json({ success: true, coupon: sanitizeCoupon(updated) });
  } catch (error: unknown) {
    const maybeError = error as { code?: number };

    if (maybeError.code === 11000) {
      await logAuditEvent(req, {
        action: 'marketing.coupon.update',
        outcome: 'failure',
        statusCode: 409,
        resourceType: 'coupon',
        resourceId: req.params.id,
        metadata: { reason: 'duplicate_code' },
      });
      res.status(409).json({ success: false, message: 'Coupon code already exists' });
      return;
    }

    await logAuditEvent(req, {
      action: 'marketing.coupon.update',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'coupon',
      resourceId: req.params.id,
      metadata: { reason: 'unexpected_error' },
    });
    res.status(500).json({ success: false, message: 'Failed to update coupon' });
  }
};

export const deleteCoupon = async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid coupon id' });
      return;
    }

    const deleted = await Coupon.findByIdAndDelete(id);

    if (!deleted) {
      await logAuditEvent(req, {
        action: 'marketing.coupon.delete',
        outcome: 'failure',
        statusCode: 404,
        resourceType: 'coupon',
        resourceId: id,
        metadata: { reason: 'coupon_not_found' },
      });
      res.status(404).json({ success: false, message: 'Coupon not found' });
      return;
    }

    await logAuditEvent(req, {
      action: 'marketing.coupon.delete',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'coupon',
      resourceId: deleted._id.toString(),
      metadata: { code: deleted.code },
    });

    res.status(200).json({ success: true, message: 'Coupon deleted successfully' });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'marketing.coupon.delete',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'coupon',
      resourceId: req.params.id,
      metadata: { reason: 'unexpected_error' },
    });
    res.status(500).json({ success: false, message: 'Failed to delete coupon' });
  }
};

export const bulkUpdateCouponStatus = async (
  req: Request<unknown, unknown, BulkCouponStatusBody>,
  res: Response
): Promise<void> => {
  try {
    const ids = Array.isArray(req.body.ids)
      ? Array.from(new Set(req.body.ids.map((id) => String(id).trim()).filter(Boolean)))
      : [];
    const { isActive } = req.body;

    if (ids.length === 0) {
      res.status(400).json({ success: false, message: 'ids must be a non-empty array' });
      return;
    }

    if (typeof isActive !== 'boolean') {
      res.status(400).json({ success: false, message: 'isActive must be a boolean' });
      return;
    }

    if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      res.status(400).json({ success: false, message: 'ids contains an invalid coupon id' });
      return;
    }

    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
    const result = await Coupon.updateMany(
      { _id: { $in: objectIds } },
      {
        $set: {
          isActive,
        },
      }
    );

    await logAuditEvent(req, {
      action: 'marketing.coupon.bulk_status.update',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'coupon',
      metadata: {
        targetCount: ids.length,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        isActive,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Coupon statuses updated',
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'marketing.coupon.bulk_status.update',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'coupon',
      metadata: { reason: 'unexpected_error' },
    });
    res.status(500).json({ success: false, message: 'Failed to update coupon statuses' });
  }
};

export const getCouponAnalytics = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const [
      totalCoupons,
      activeCoupons,
      inactiveCoupons,
      usageStatsRaw,
      topUsedCoupons,
      nearingUsageLimitCoupons,
    ] = await Promise.all([
      Coupon.countDocuments({}),
      Coupon.countDocuments({ isActive: true }),
      Coupon.countDocuments({ isActive: false }),
      Coupon.aggregate<{ totalUsedCount: number; averageUsedCount: number }>([
        {
          $group: {
            _id: null,
            totalUsedCount: { $sum: '$usedCount' },
            averageUsedCount: { $avg: '$usedCount' },
          },
        },
        {
          $project: {
            _id: 0,
            totalUsedCount: 1,
            averageUsedCount: 1,
          },
        },
      ]),
      Coupon.find({})
        .sort({ usedCount: -1, createdAt: -1 })
        .limit(5)
        .select('code usedCount usageLimit isActive createdAt'),
      Coupon.aggregate<{
        id: mongoose.Types.ObjectId;
        code: string;
        usedCount: number;
        usageLimit: number;
        usageRatio: number;
      }>([
        {
          $match: {
            usageLimit: { $ne: null, $gt: 0 },
          },
        },
        {
          $project: {
            id: '$_id',
            code: 1,
            usedCount: 1,
            usageLimit: 1,
            usageRatio: { $divide: ['$usedCount', '$usageLimit'] },
          },
        },
        {
          $match: {
            usageRatio: { $gte: 0.8 },
          },
        },
        {
          $sort: {
            usageRatio: -1,
            usedCount: -1,
          },
        },
        {
          $limit: 10,
        },
      ]),
    ]);

    const usageStats = usageStatsRaw[0] ?? { totalUsedCount: 0, averageUsedCount: 0 };

    res.status(200).json({
      success: true,
      analytics: {
        totals: {
          totalCoupons,
          activeCoupons,
          inactiveCoupons,
        },
        usage: {
          totalUsedCount: usageStats.totalUsedCount,
          averageUsedCount: Math.round((usageStats.averageUsedCount ?? 0) * 100) / 100,
        },
        topUsedCoupons: topUsedCoupons.map((coupon) => ({
          id: coupon._id.toString(),
          code: coupon.code,
          usedCount: coupon.usedCount,
          usageLimit: coupon.usageLimit,
          isActive: coupon.isActive,
          createdAt: coupon.createdAt,
        })),
        nearingUsageLimitCoupons: nearingUsageLimitCoupons.map((coupon) => ({
          id: coupon.id.toString(),
          code: coupon.code,
          usedCount: coupon.usedCount,
          usageLimit: coupon.usageLimit,
          usageRatio: Math.round(coupon.usageRatio * 10000) / 100,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch coupon analytics' });
  }
};
