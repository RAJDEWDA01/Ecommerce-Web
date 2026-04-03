import mongoose, { type ClientSession, type Types } from 'mongoose';
import Coupon, { type ICoupon } from '../models/Coupon.js';
import Order from '../models/Order.js';

interface ValidateCouponInput {
  code: string;
  subtotal: number;
  customerId: Types.ObjectId | null;
  now?: Date;
}

interface CouponValidationSuccess {
  valid: true;
  coupon: ICoupon;
  normalizedCode: string;
  discountAmount: number;
  message: string;
}

interface CouponValidationFailure {
  valid: false;
  normalizedCode: string;
  discountAmount: 0;
  message: string;
}

type CouponValidationResult = CouponValidationSuccess | CouponValidationFailure;

interface CouponUsageIncrementInput {
  couponId: Types.ObjectId;
  session?: ClientSession;
}

const normalizeCode = (rawCode: string): string => rawCode.trim().toUpperCase();

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

const computeDiscountAmount = (coupon: ICoupon, subtotal: number): number => {
  if (coupon.discountType === 'percentage') {
    const percentageDiscount = (subtotal * coupon.discountValue) / 100;
    const cappedDiscount =
      typeof coupon.maxDiscountAmount === 'number'
        ? Math.min(percentageDiscount, coupon.maxDiscountAmount)
        : percentageDiscount;

    return roundCurrency(Math.max(0, cappedDiscount));
  }

  return roundCurrency(Math.max(0, Math.min(coupon.discountValue, subtotal)));
};

export const validateCouponForOrder = async ({
  code,
  subtotal,
  customerId,
  now = new Date(),
}: ValidateCouponInput): Promise<CouponValidationResult> => {
  const normalizedCode = normalizeCode(code);

  if (!normalizedCode) {
    return {
      valid: false,
      normalizedCode,
      discountAmount: 0,
      message: 'Coupon code is required',
    };
  }

  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return {
      valid: false,
      normalizedCode,
      discountAmount: 0,
      message: 'Order subtotal is invalid for coupon evaluation',
    };
  }

  const coupon = await Coupon.findOne({ code: normalizedCode });

  if (!coupon) {
    return {
      valid: false,
      normalizedCode,
      discountAmount: 0,
      message: 'Coupon does not exist',
    };
  }

  if (!coupon.isActive) {
    return {
      valid: false,
      normalizedCode,
      discountAmount: 0,
      message: 'Coupon is currently inactive',
    };
  }

  if (coupon.startsAt && now.getTime() < coupon.startsAt.getTime()) {
    return {
      valid: false,
      normalizedCode,
      discountAmount: 0,
      message: 'Coupon is not active yet',
    };
  }

  if (coupon.endsAt && now.getTime() > coupon.endsAt.getTime()) {
    return {
      valid: false,
      normalizedCode,
      discountAmount: 0,
      message: 'Coupon has expired',
    };
  }

  if (subtotal < coupon.minOrderAmount) {
    return {
      valid: false,
      normalizedCode,
      discountAmount: 0,
      message: `Minimum order amount for this coupon is ₹${coupon.minOrderAmount}`,
    };
  }

  if (typeof coupon.usageLimit === 'number' && coupon.usedCount >= coupon.usageLimit) {
    return {
      valid: false,
      normalizedCode,
      discountAmount: 0,
      message: 'Coupon usage limit has been reached',
    };
  }

  if (customerId && typeof coupon.perUserLimit === 'number') {
    const usageCount = await Order.countDocuments({
      customer: customerId,
      couponCode: normalizedCode,
    });

    if (usageCount >= coupon.perUserLimit) {
      return {
        valid: false,
        normalizedCode,
        discountAmount: 0,
        message: 'You have reached the per-user usage limit for this coupon',
      };
    }
  }

  const discountAmount = computeDiscountAmount(coupon, subtotal);

  if (discountAmount <= 0) {
    return {
      valid: false,
      normalizedCode,
      discountAmount: 0,
      message: 'Coupon does not apply to this order',
    };
  }

  return {
    valid: true,
    coupon,
    normalizedCode,
    discountAmount,
    message: 'Coupon applied successfully',
  };
};

export const incrementCouponUsage = async ({
  couponId,
  session,
}: CouponUsageIncrementInput): Promise<boolean> => {
  const filter: Record<string, unknown> = {
    _id: couponId,
    $or: [{ usageLimit: null }, { $expr: { $gt: ['$usageLimit', '$usedCount'] } }],
  };

  const updated = await Coupon.findOneAndUpdate(
    filter,
    {
      $inc: {
        usedCount: 1,
      },
    },
    {
      returnDocument: 'after',
      ...(session ? { session } : {}),
    }
  );

  return Boolean(updated);
};

export const decrementCouponUsageIfPossible = async (
  couponId: Types.ObjectId
): Promise<void> => {
  await Coupon.updateOne(
    {
      _id: couponId,
      usedCount: { $gt: 0 },
    },
    {
      $inc: {
        usedCount: -1,
      },
    }
  );
};

export const isValidCouponObjectId = (value: string): boolean => {
  return mongoose.Types.ObjectId.isValid(value);
};

export type { CouponValidationResult };
