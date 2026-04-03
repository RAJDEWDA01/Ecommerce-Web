import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import mongoose, { type ClientSession, type QueryFilter } from 'mongoose';
import env from '../config/env.js';
import Order, { type IOrder } from '../models/Order.js';
import IdempotencyRecord, { type IIdempotencyRecord } from '../models/IdempotencyRecord.js';
import Product from '../models/Product.js';
import Address, { type IAddress } from '../models/Address.js';
import type { CustomerAuthRequest } from '../middleware/customerAuth.js';
import type { AuthActor, AuthContextRequest } from '../middleware/authContext.js';
import { logAuditEvent } from '../utils/audit.js';
import { sendEmail } from '../utils/email.js';
import {
  getAdminConsoleOrdersUrl,
  safeSendAdminNotificationEmail,
} from '../services/adminNotificationService.js';
import {
  decrementCouponUsageIfPossible,
  incrementCouponUsage,
  validateCouponForOrder,
} from '../services/couponService.js';

interface OrderItemInput {
  productId: string;
  quantity: number;
  variantSku?: string;
}

interface ShippingInfoInput {
  fullName: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  phone: string;
}

interface CreateOrderBody {
  shippingInfo?: Partial<ShippingInfoInput>;
  cartItems?: OrderItemInput[];
  couponCode?: string;
  addressId?: string;
}

interface UpdateOrderFulfillmentBody {
  courierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  packedAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
}

interface UpdateOrderStatusBody {
  orderStatus?: string;
  fulfillment?: UpdateOrderFulfillmentBody;
}

interface RequestOrderCancellationBody {
  reason?: string;
}

interface ReviewOrderCancellationBody {
  action?: 'approve' | 'reject';
  note?: string;
}

interface UpdateOrderRefundBody {
  status?: 'pending' | 'processed' | 'failed';
  amount?: number;
  reference?: string | null;
  note?: string | null;
  gatewayRefundId?: string | null;
  gatewaySettlementStatus?: 'unknown' | 'pending' | 'settled' | 'failed';
  gatewaySettlementAt?: string | null;
}

interface GetMyOrdersQuery {
  orderStatus?: string;
  paymentStatus?: string;
  page?: string;
  limit?: string;
  fromDate?: string;
  toDate?: string;
}

interface GetOrdersQuery extends GetMyOrdersQuery {
  search?: string;
  customerId?: string;
  refundStatus?: 'not_required' | 'pending' | 'processed' | 'failed';
  refundReference?: string;
  refundFromDate?: string;
  refundToDate?: string;
}

interface PaginationMeta {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface NormalizedOrderItemInput {
  productId: string;
  quantity: number;
  variantSku: string | null;
}

interface OrderDocumentItem {
  product: mongoose.Types.ObjectId;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface OrderDocumentInput {
  customer: mongoose.Types.ObjectId | null;
  shippingInfo: ShippingInfoInput;
  sourceAddressId: mongoose.Types.ObjectId | null;
  sourceAddressSnapshot: SourceAddressSnapshot | null;
  items: OrderDocumentItem[];
  subtotal: number;
  discountAmount: number;
  couponCode: string | null;
  shippingFee: number;
  totalAmount: number;
  currency: 'INR';
  paymentStatus: 'pending';
  orderStatus: 'placed';
}

interface PersistOrderInput {
  normalizedItems: NormalizedOrderItemInput[];
  productNameById: Map<string, string>;
  orderDocument: OrderDocumentInput;
  couponId: mongoose.Types.ObjectId | null;
}

interface SourceAddressSnapshot {
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface CancellationStateSnapshot {
  status: 'none' | 'requested' | 'approved' | 'rejected';
  reason: string | null;
  requestedAt: Date | null;
  requestedBy: mongoose.Types.ObjectId | null;
  reviewedAt: Date | null;
  reviewedBy: mongoose.Types.ObjectId | null;
  reviewNote: string | null;
}

type CancellationNotificationType = 'requested' | 'approved' | 'rejected';
type RefundNotificationType = 'pending' | 'processed' | 'failed';

interface RefundStateSnapshot {
  status: 'not_required' | 'pending' | 'processed' | 'failed';
  amount: number;
  currency: 'INR';
  initiatedAt: Date | null;
  processedAt: Date | null;
  updatedBy: mongoose.Types.ObjectId | null;
  reference: string | null;
  note: string | null;
  gatewayRefundId: string | null;
  gatewaySettlementStatus: 'unknown' | 'pending' | 'settled' | 'failed';
  gatewaySettlementAt: Date | null;
}

interface FulfillmentStateSnapshot {
  courierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  packedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
}

const ORDER_STATUSES = ['placed', 'processing', 'shipped', 'delivered', 'cancelled'] as const;
const PAYMENT_STATUSES = ['pending', 'paid', 'failed'] as const;
const REFUND_STATUSES = ['not_required', 'pending', 'processed', 'failed'] as const;
const IDEMPOTENCY_SCOPE = 'create_order' as const;
const IDEMPOTENCY_KEY_HEADER = 'x-idempotency-key';
const CANCELLATION_REASON_MAX_LENGTH = 500;
const CANCELLATION_NOTE_MAX_LENGTH = 500;
const REFUND_REFERENCE_MAX_LENGTH = 120;
const REFUND_NOTE_MAX_LENGTH = 500;
const REFUND_GATEWAY_ID_MAX_LENGTH = 120;
const FULFILLMENT_TEXT_MAX_LENGTH = 140;
const FULFILLMENT_URL_MAX_LENGTH = 512;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const DEFAULT_ADMIN_LIMIT = 100;
const MAX_LIMIT = 200;

let hasLoggedTransactionFallback = false;

class OrderProcessingError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'OrderProcessingError';
  }
}

const parseIdempotencyTtlHours = (): number => {
  const raw = process.env.IDEMPOTENCY_TTL_HOURS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 168) {
    return 24;
  }

  return parsed;
};

const parseIdempotencyLockSeconds = (): number => {
  const raw = process.env.IDEMPOTENCY_LOCK_SECONDS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 300) {
    return 90;
  }

  return parsed;
};

const IDEMPOTENCY_TTL_HOURS = parseIdempotencyTtlHours();
const IDEMPOTENCY_LOCK_SECONDS = parseIdempotencyLockSeconds();

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

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

const parseDateValue = (raw: unknown, boundary: 'start' | 'end'): Date | null | 'invalid' => {
  if (raw === undefined || raw === null) {
    return null;
  }

  const normalized = String(raw).trim();

  if (!normalized) {
    return null;
  }

  const dayOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
  const isoSource = dayOnlyPattern.test(normalized)
    ? `${normalized}${boundary === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z'}`
    : normalized;

  const parsed = new Date(isoSource);

  if (Number.isNaN(parsed.getTime())) {
    return 'invalid';
  }

  return parsed;
};

const parseOptionalStringField = (
  raw: unknown,
  fieldName: string,
  maxLength: number
): { isProvided: boolean; value: string | null; error?: string } => {
  if (raw === undefined) {
    return { isProvided: false, value: null };
  }

  if (raw === null) {
    return { isProvided: true, value: null };
  }

  if (typeof raw !== 'string') {
    return { isProvided: true, value: null, error: `${fieldName} must be a string or null` };
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return { isProvided: true, value: null };
  }

  if (trimmed.length > maxLength) {
    return {
      isProvided: true,
      value: null,
      error: `${fieldName} must be ${maxLength} characters or less`,
    };
  }

  return { isProvided: true, value: trimmed };
};

const parseOptionalDateTimeField = (
  raw: unknown,
  fieldName: string
): { isProvided: boolean; value: Date | null; error?: string } => {
  if (raw === undefined) {
    return { isProvided: false, value: null };
  }

  if (raw === null || raw === '') {
    return { isProvided: true, value: null };
  }

  if (typeof raw !== 'string') {
    return {
      isProvided: true,
      value: null,
      error: `${fieldName} must be a valid date-time string or null`,
    };
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return { isProvided: true, value: null };
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return {
      isProvided: true,
      value: null,
      error: `${fieldName} must be a valid date-time string or null`,
    };
  }

  return { isProvided: true, value: parsed };
};

const buildCreatedAtFilter = (
  fromDate: unknown,
  toDate: unknown
): { filter?: { $gte?: Date; $lte?: Date }; error?: string } => {
  const from = parseDateValue(fromDate, 'start');

  if (from === 'invalid') {
    return { error: 'fromDate must be a valid date or ISO date-time' };
  }

  const to = parseDateValue(toDate, 'end');

  if (to === 'invalid') {
    return { error: 'toDate must be a valid date or ISO date-time' };
  }

  if (from && to && from.getTime() > to.getTime()) {
    return { error: 'fromDate cannot be greater than toDate' };
  }

  if (!from && !to) {
    return {};
  }

  return {
    filter: {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    },
  };
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

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const csvEscape = (value: unknown): string => {
  const stringValue =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : String(value);

  if (!/[",\n\r]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replace(/"/g, '""')}"`;
};

const toCsvTimestampLabel = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
};

const buildAdminOrderFilters = (
  query: GetOrdersQuery
): { filters?: QueryFilter<IOrder>; error?: string } => {
  const {
    orderStatus,
    paymentStatus,
    fromDate,
    toDate,
    search,
    customerId,
    refundStatus,
    refundReference,
    refundFromDate,
    refundToDate,
  } = query;

  const filters: QueryFilter<IOrder> = {};

  if (orderStatus) {
    if (!ORDER_STATUSES.includes(orderStatus as (typeof ORDER_STATUSES)[number])) {
      return {
        error: `Invalid orderStatus. Allowed values: ${ORDER_STATUSES.join(', ')}`,
      };
    }

    filters.orderStatus = orderStatus;
  }

  if (paymentStatus) {
    if (!PAYMENT_STATUSES.includes(paymentStatus as (typeof PAYMENT_STATUSES)[number])) {
      return {
        error: `Invalid paymentStatus. Allowed values: ${PAYMENT_STATUSES.join(', ')}`,
      };
    }

    filters.paymentStatus = paymentStatus;
  }

  if (refundStatus) {
    if (!REFUND_STATUSES.includes(refundStatus as (typeof REFUND_STATUSES)[number])) {
      return {
        error: `Invalid refundStatus. Allowed values: ${REFUND_STATUSES.join(', ')}`,
      };
    }

    filters['refundInfo.status'] = refundStatus;
  }

  if (customerId) {
    const safeCustomerId = customerId.trim();

    if (!mongoose.Types.ObjectId.isValid(safeCustomerId)) {
      return { error: 'customerId must be a valid ObjectId' };
    }

    filters.customer = new mongoose.Types.ObjectId(safeCustomerId);
  }

  const createdAtFilterResult = buildCreatedAtFilter(fromDate, toDate);

  if (createdAtFilterResult.error) {
    return { error: createdAtFilterResult.error };
  }

  if (createdAtFilterResult.filter) {
    filters.createdAt = createdAtFilterResult.filter;
  }

  const refundDateFilterResult = buildCreatedAtFilter(refundFromDate, refundToDate);

  if (refundDateFilterResult.error) {
    return {
      error: `refundFromDate/refundToDate: ${refundDateFilterResult.error}`,
    };
  }

  if (refundDateFilterResult.filter) {
    filters['refundInfo.initiatedAt'] = refundDateFilterResult.filter;
  }

  const safeRefundReference = refundReference?.trim();

  if (safeRefundReference) {
    const escaped = escapeRegExp(safeRefundReference);
    filters['refundInfo.reference'] = { $regex: new RegExp(escaped, 'i') };
  }

  const safeSearch = search?.trim();

  if (safeSearch) {
    const escaped = escapeRegExp(safeSearch);
    const regex = new RegExp(escaped, 'i');

    const searchFilters: QueryFilter<IOrder>[] = [
      { 'shippingInfo.fullName': { $regex: regex } },
      { 'shippingInfo.email': { $regex: regex } },
      { 'shippingInfo.phone': { $regex: regex } },
      { 'refundInfo.reference': { $regex: regex } },
    ];

    if (mongoose.Types.ObjectId.isValid(safeSearch)) {
      searchFilters.push({ _id: new mongoose.Types.ObjectId(safeSearch) });
    }

    filters.$or = searchFilters;
  }

  return { filters };
};

const parseIdempotencyKey = (req: { header: (name: string) => string | undefined }): string | null => {
  const rawHeader = req.header(IDEMPOTENCY_KEY_HEADER)?.trim();

  if (!rawHeader) {
    return null;
  }

  if (rawHeader.length < 8 || rawHeader.length > 200 || !/^[A-Za-z0-9_.:-]+$/.test(rawHeader)) {
    return '';
  }

  return rawHeader;
};

const createRequestHash = (body: unknown): string => {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
};

interface IdempotencyPreparationResult {
  canProceed: boolean;
  record?: IIdempotencyRecord;
  replayResponse?: { status: number; body: Record<string, unknown> };
  errorResponse?: { status: number; body: Record<string, unknown> };
}

const prepareIdempotencyRecord = async (
  key: string | null,
  requestHash: string,
  customerId: mongoose.Types.ObjectId | null
): Promise<IdempotencyPreparationResult> => {
  if (!key) {
    return { canProceed: true };
  }

  const now = Date.now();
  const expiresAt = new Date(now + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);
  const lockExpiresAt = new Date(now + IDEMPOTENCY_LOCK_SECONDS * 1000);
  const existing = await IdempotencyRecord.findOne({ scope: IDEMPOTENCY_SCOPE, key });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return {
        canProceed: false,
        errorResponse: {
          status: 409,
          body: {
            success: false,
            message: 'Idempotency key was already used with a different request payload.',
          },
        },
      };
    }

    if (
      existing.status === 'completed' &&
      typeof existing.responseStatus === 'number' &&
      existing.responseBody
    ) {
      return {
        canProceed: false,
        replayResponse: {
          status: existing.responseStatus,
          body: existing.responseBody,
        },
      };
    }

    if (existing.lockExpiresAt && existing.lockExpiresAt.getTime() > now) {
      return {
        canProceed: false,
        errorResponse: {
          status: 409,
          body: {
            success: false,
            message: 'Order request is already being processed. Please retry shortly.',
          },
        },
      };
    }

    existing.status = 'processing';
    existing.lockExpiresAt = lockExpiresAt;
    existing.expiresAt = expiresAt;
    existing.customer = customerId;
    await existing.save();

    return { canProceed: true, record: existing };
  }

  try {
    const created = await IdempotencyRecord.create({
      scope: IDEMPOTENCY_SCOPE,
      key,
      requestHash,
      status: 'processing',
      customer: customerId,
      lockExpiresAt,
      expiresAt,
    });

    return { canProceed: true, record: created };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await IdempotencyRecord.findOne({ scope: IDEMPOTENCY_SCOPE, key });

      if (duplicate && duplicate.status === 'completed' && typeof duplicate.responseStatus === 'number' && duplicate.responseBody) {
        return {
          canProceed: false,
          replayResponse: {
            status: duplicate.responseStatus,
            body: duplicate.responseBody,
          },
        };
      }

      return {
        canProceed: false,
        errorResponse: {
          status: 409,
          body: {
            success: false,
            message: 'Order request is already being processed. Please retry shortly.',
          },
        },
      };
    }

    throw error;
  }
};

const completeIdempotencyRecord = async (
  record: IIdempotencyRecord | undefined,
  status: number,
  body: Record<string, unknown>
): Promise<void> => {
  if (!record) {
    return;
  }

  record.status = 'completed';
  record.responseStatus = status;
  record.responseBody = body;
  record.lockExpiresAt = null;
  record.expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);
  await record.save();
};

const rollbackIdempotencyRecord = async (record: IIdempotencyRecord | undefined): Promise<void> => {
  if (!record) {
    return;
  }

  await IdempotencyRecord.deleteOne({
    _id: record._id,
    status: 'processing',
  });
};

const validateShippingInfo = (
  shippingInfo: Partial<ShippingInfoInput> | undefined
): { valid: boolean; message?: string } => {
  if (!shippingInfo) {
    return { valid: false, message: 'Shipping info is required' };
  }

  if (!isNonEmptyString(shippingInfo.fullName)) {
    return { valid: false, message: 'Full name is required' };
  }

  if (!isNonEmptyString(shippingInfo.email)) {
    return { valid: false, message: 'Email is required' };
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(shippingInfo.email.trim())) {
    return { valid: false, message: 'Please provide a valid email address' };
  }

  if (!isNonEmptyString(shippingInfo.address)) {
    return { valid: false, message: 'Address is required' };
  }

  if (!isNonEmptyString(shippingInfo.city)) {
    return { valid: false, message: 'City is required' };
  }

  if (!isNonEmptyString(shippingInfo.postalCode)) {
    return { valid: false, message: 'Postal code is required' };
  }

  if (!isNonEmptyString(shippingInfo.phone)) {
    return { valid: false, message: 'Phone number is required' };
  }

  return { valid: true };
};

const buildSourceAddressSnapshot = (address: IAddress): SourceAddressSnapshot => {
  return {
    label: address.label,
    fullName: address.fullName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2 ?? null,
    landmark: address.landmark ?? null,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
  };
};

const isTransactionUnsupportedError = (error: unknown): boolean => {
  const code = (error as { code?: number } | null)?.code;

  if (code === 20) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes('transaction numbers are only allowed') ||
    message.includes('replica set') ||
    message.includes('transactions are not supported')
  );
};

const decrementStockForItems = async (
  normalizedItems: NormalizedOrderItemInput[],
  productNameById: Map<string, string>,
  decrementedItems: NormalizedOrderItemInput[],
  session?: ClientSession
): Promise<void> => {
  for (const item of normalizedItems) {
    if (item.variantSku) {
      const updatedProduct = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          stockQuantity: { $gte: item.quantity },
          variants: {
            $elemMatch: {
              sku: item.variantSku,
              stockQuantity: { $gte: item.quantity },
            },
          },
        },
        {
          $inc: {
            stockQuantity: -item.quantity,
            'variants.$[selected].stockQuantity': -item.quantity,
          },
        },
        {
          arrayFilters: [{ 'selected.sku': item.variantSku }],
          returnDocument: 'after',
          ...(session ? { session } : {}),
        }
      );

      if (!updatedProduct) {
        const productName = productNameById.get(item.productId);

        if (productName) {
          throw new OrderProcessingError(
            409,
            `Stock changed during checkout for ${productName}. Please review your cart and try again.`
          );
        }

        throw new OrderProcessingError(
          409,
          'Stock changed during checkout. Please review your cart and try again.'
        );
      }

      decrementedItems.push(item);
      continue;
    }

    const updatedProduct = await Product.findOneAndUpdate(
      {
        _id: item.productId,
        stockQuantity: { $gte: item.quantity },
      },
      {
        $inc: { stockQuantity: -item.quantity },
      },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      }
    );

    if (!updatedProduct) {
      const productName = productNameById.get(item.productId);

      if (productName) {
        throw new OrderProcessingError(
          409,
          `Stock changed during checkout for ${productName}. Please review your cart and try again.`
        );
      }

      throw new OrderProcessingError(
        409,
        'Stock changed during checkout. Please review your cart and try again.'
      );
    }

    decrementedItems.push(item);
  }
};

const rollbackDecrementedStock = async (decrementedItems: NormalizedOrderItemInput[]): Promise<void> => {
  if (decrementedItems.length === 0) {
    return;
  }

  await Promise.all(
    decrementedItems.map(async (item) => {
      if (item.variantSku) {
        await Product.updateOne(
          {
            _id: item.productId,
            'variants.sku': item.variantSku,
          },
          {
            $inc: {
              stockQuantity: item.quantity,
              'variants.$.stockQuantity': item.quantity,
            },
          }
        );
        return;
      }

      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stockQuantity: item.quantity },
      });
    })
  );
};

const createOrderWithTransaction = async (input: PersistOrderInput): Promise<IOrder> => {
  const session = await mongoose.startSession();
  let createdOrder: IOrder | null = null;

  try {
    await session.withTransaction(async () => {
      const decrementedItems: NormalizedOrderItemInput[] = [];
      await decrementStockForItems(
        input.normalizedItems,
        input.productNameById,
        decrementedItems,
        session
      );

      if (input.couponId) {
        const usageIncremented = await incrementCouponUsage({
          couponId: input.couponId,
          session,
        });

        if (!usageIncremented) {
          throw new OrderProcessingError(
            409,
            'Coupon usage limit was reached during checkout. Please retry without this coupon.'
          );
        }
      }

      const createdOrders = await Order.create([input.orderDocument], { session });
      const firstOrder = createdOrders[0];

      if (!firstOrder) {
        throw new Error('Order creation failed in transaction');
      }

      createdOrder = firstOrder;
    });
  } finally {
    await session.endSession();
  }

  if (!createdOrder) {
    throw new Error('Order transaction was not committed');
  }

  return createdOrder;
};

const createOrderWithoutTransaction = async (input: PersistOrderInput): Promise<IOrder> => {
  const decrementedItems: NormalizedOrderItemInput[] = [];
  let couponUsageIncremented = false;

  try {
    await decrementStockForItems(
      input.normalizedItems,
      input.productNameById,
      decrementedItems
    );

    if (input.couponId) {
      couponUsageIncremented = await incrementCouponUsage({
        couponId: input.couponId,
      });

      if (!couponUsageIncremented) {
        throw new OrderProcessingError(
          409,
          'Coupon usage limit was reached during checkout. Please retry without this coupon.'
        );
      }
    }

    const order = await Order.create(input.orderDocument);
    return order;
  } catch (error) {
    if (couponUsageIncremented && input.couponId) {
      await decrementCouponUsageIfPossible(input.couponId);
    }

    await rollbackDecrementedStock(decrementedItems);
    throw error;
  }
};

const persistOrder = async (input: PersistOrderInput): Promise<IOrder> => {
  try {
    return await createOrderWithTransaction(input);
  } catch (error) {
    if (!isTransactionUnsupportedError(error)) {
      throw error;
    }

    if (!hasLoggedTransactionFallback) {
      console.warn(
        'MongoDB transactions are not supported by the current topology. Falling back to compensated writes for checkout.'
      );
      hasLoggedTransactionFallback = true;
    }

    return createOrderWithoutTransaction(input);
  }
};

const resolveOrderCustomerId = (customer: unknown): string | null => {
  if (!customer) {
    return null;
  }

  if (typeof customer === 'string') {
    return customer;
  }

  if (customer instanceof mongoose.Types.ObjectId) {
    return customer.toString();
  }

  if (typeof customer === 'object' && customer !== null && '_id' in customer) {
    const nestedId = (customer as { _id?: unknown })._id;

    if (typeof nestedId === 'string') {
      return nestedId;
    }

    if (nestedId instanceof mongoose.Types.ObjectId) {
      return nestedId.toString();
    }
  }

  if (typeof customer === 'object' && customer !== null && 'toString' in customer) {
    const stringified = (customer as { toString: () => string }).toString();
    return stringified;
  }

  return null;
};

const canAccessOrder = (orderCustomer: unknown, actor: AuthActor | undefined): boolean => {
  const ownerCustomerId = resolveOrderCustomerId(orderCustomer);

  if (!ownerCustomerId) {
    return true;
  }

  if (!actor) {
    return false;
  }

  if (actor.role === 'admin') {
    return true;
  }

  return actor.id === ownerCustomerId;
};

const canCustomerRequestCancellation = (status: IOrder['orderStatus']): boolean => {
  return status === 'placed' || status === 'processing';
};

const restoreOrderStock = async (order: IOrder): Promise<void> => {
  if (!order.items.length) {
    return;
  }

  await Product.bulkWrite(
    order.items.map((item) => ({
      updateOne: {
        filter: { _id: item.product },
        update: {
          $inc: {
            stockQuantity: item.quantity,
          },
        },
      },
    }))
  );
};

const getCancellationState = (order: IOrder): CancellationStateSnapshot => {
  const current = order.cancellationRequest;

  return {
    status: current?.status ?? 'none',
    reason: current?.reason ?? null,
    requestedAt: current?.requestedAt ?? null,
    requestedBy:
      current?.requestedBy && current.requestedBy instanceof mongoose.Types.ObjectId
        ? current.requestedBy
        : null,
    reviewedAt: current?.reviewedAt ?? null,
    reviewedBy:
      current?.reviewedBy && current.reviewedBy instanceof mongoose.Types.ObjectId
        ? current.reviewedBy
        : null,
    reviewNote: current?.reviewNote ?? null,
  };
};

const asObjectIdOrNull = (value: unknown): mongoose.Types.ObjectId | null => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  return null;
};

const getRefundState = (order: IOrder): RefundStateSnapshot => {
  const current = order.refundInfo;

  return {
    status: current?.status ?? 'not_required',
    amount: typeof current?.amount === 'number' ? current.amount : 0,
    currency: 'INR',
    initiatedAt: current?.initiatedAt ?? null,
    processedAt: current?.processedAt ?? null,
    updatedBy: asObjectIdOrNull(current?.updatedBy),
    reference: current?.reference ?? null,
    note: current?.note ?? null,
    gatewayRefundId: current?.gatewayRefundId ?? null,
    gatewaySettlementStatus: current?.gatewaySettlementStatus ?? 'unknown',
    gatewaySettlementAt: current?.gatewaySettlementAt ?? null,
  };
};

const getFulfillmentState = (order: IOrder): FulfillmentStateSnapshot => {
  const current = order.fulfillmentInfo;

  return {
    courierName: current?.courierName ?? null,
    trackingNumber: current?.trackingNumber ?? null,
    trackingUrl: current?.trackingUrl ?? null,
    packedAt: current?.packedAt ?? null,
    shippedAt: current?.shippedAt ?? null,
    deliveredAt: current?.deliveredAt ?? null,
  };
};

const areNullableDatesEqual = (left: Date | null, right: Date | null): boolean => {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.getTime() === right.getTime();
};

const markRefundPendingIfRequired = (
  order: IOrder,
  updatedBy: mongoose.Types.ObjectId | null,
  note?: string | null
): void => {
  if (order.paymentStatus !== 'paid') {
    order.refundInfo = {
      ...getRefundState(order),
      status: 'not_required',
      amount: 0,
      currency: 'INR',
      initiatedAt: null,
      processedAt: null,
      updatedBy: updatedBy ?? null,
      reference: null,
      note: note ?? null,
      gatewayRefundId: null,
      gatewaySettlementStatus: 'unknown',
      gatewaySettlementAt: null,
    };
    return;
  }

  const current = getRefundState(order);

  if (current.status === 'processed') {
    return;
  }

  order.refundInfo = {
    ...current,
    status: 'pending',
    amount: current.amount > 0 ? current.amount : order.totalAmount,
    currency: 'INR',
    initiatedAt: current.initiatedAt ?? new Date(),
    processedAt: null,
    updatedBy: updatedBy ?? null,
    note: note ?? current.note ?? null,
    gatewayRefundId: current.gatewayRefundId ?? null,
    gatewaySettlementStatus: current.gatewaySettlementStatus ?? 'unknown',
    gatewaySettlementAt: current.gatewaySettlementAt ?? null,
  };
};

const buildOrderDetailsUrl = (orderId: string): string => {
  return `${env.frontendUrl}/account?highlightOrder=${encodeURIComponent(orderId)}`;
};

const safeSendOrderCancellationEmail = async (
  order: IOrder,
  type: CancellationNotificationType,
  reviewNote?: string | null
): Promise<void> => {
  const recipient = order.shippingInfo.email?.trim();

  if (!recipient) {
    return;
  }

  const orderId = order._id.toString();
  const orderDetailsUrl = buildOrderDetailsUrl(orderId);
  const heading =
    type === 'requested'
      ? 'Cancellation request received'
      : type === 'approved'
        ? 'Cancellation approved'
        : 'Cancellation request rejected';
  const message =
    type === 'requested'
      ? 'We have received your cancellation request and our team will review it shortly.'
      : type === 'approved'
        ? 'Your cancellation request has been approved and your order has been cancelled.'
        : 'Your cancellation request was reviewed and could not be approved.';
  const noteLine = reviewNote ? `\nAdmin note: ${reviewNote}` : '';

  try {
    await sendEmail({
      to: recipient,
      subject: `Gaumaya Order ${orderId}: ${heading}`,
      text: `${message}\nOrder ID: ${orderId}\nTrack updates: ${orderDetailsUrl}${noteLine}`,
      html: `
        <p>${message}</p>
        <p><strong>Order ID:</strong> ${orderId}</p>
        ${reviewNote ? `<p><strong>Admin note:</strong> ${reviewNote}</p>` : ''}
        <p><a href="${orderDetailsUrl}">View your account orders</a></p>
      `,
    });
  } catch (error) {
    console.error('Failed to send cancellation notification email:', error);
  }
};

const safeSendRefundStatusEmail = async (
  order: IOrder,
  type: RefundNotificationType
): Promise<void> => {
  const recipient = order.shippingInfo.email?.trim();

  if (!recipient) {
    return;
  }

  const refund = getRefundState(order);
  const orderId = order._id.toString();
  const orderDetailsUrl = buildOrderDetailsUrl(orderId);
  const heading =
    type === 'pending'
      ? 'Refund initiated'
      : type === 'processed'
        ? 'Refund processed'
        : 'Refund update: action required';
  const message =
    type === 'pending'
      ? 'Your refund has been initiated and is being processed.'
      : type === 'processed'
        ? 'Your refund has been processed successfully.'
        : 'We could not process your refund in this attempt. Our support team will follow up.';

  try {
    await sendEmail({
      to: recipient,
      subject: `Gaumaya Order ${orderId}: ${heading}`,
      text: `${message}\nOrder ID: ${orderId}\nRefund status: ${refund.status}\nAmount: INR ${refund.amount}\nTrack updates: ${orderDetailsUrl}`,
      html: `
        <p>${message}</p>
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p><strong>Refund status:</strong> ${refund.status}</p>
        <p><strong>Amount:</strong> INR ${refund.amount}</p>
        <p><a href="${orderDetailsUrl}">View your account orders</a></p>
      `,
    });
  } catch (error) {
    console.error('Failed to send refund notification email:', error);
  }
};

const safeSendOrderStatusEmail = async (
  order: IOrder,
  previousStatus: IOrder['orderStatus'],
  nextStatus: IOrder['orderStatus']
): Promise<void> => {
  const recipient = order.shippingInfo.email?.trim();

  if (!recipient) {
    return;
  }

  const fulfillment = getFulfillmentState(order);
  const orderId = order._id.toString();
  const orderDetailsUrl = buildOrderDetailsUrl(orderId);
  const statusMessage =
    previousStatus === nextStatus
      ? 'Your order tracking details were updated.'
      : `Your order status changed from ${previousStatus} to ${nextStatus}.`;
  const fulfillmentSummary = [
    fulfillment.courierName ? `Courier: ${fulfillment.courierName}` : null,
    fulfillment.trackingNumber ? `Tracking number: ${fulfillment.trackingNumber}` : null,
    fulfillment.trackingUrl ? `Tracking link: ${fulfillment.trackingUrl}` : null,
    fulfillment.packedAt ? `Packed at: ${fulfillment.packedAt.toISOString()}` : null,
    fulfillment.shippedAt ? `Shipped at: ${fulfillment.shippedAt.toISOString()}` : null,
    fulfillment.deliveredAt ? `Delivered at: ${fulfillment.deliveredAt.toISOString()}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
  const heading =
    previousStatus === nextStatus ? 'Tracking details updated' : `Order status updated to ${nextStatus}`;

  try {
    await sendEmail({
      to: recipient,
      subject: `Gaumaya Order ${orderId}: ${heading}`,
      text: `${statusMessage}\nOrder ID: ${orderId}${
        fulfillmentSummary ? `\n${fulfillmentSummary}` : ''
      }\nTrack updates: ${orderDetailsUrl}`,
      html: `
        <p>${statusMessage}</p>
        <p><strong>Order ID:</strong> ${orderId}</p>
        ${
          fulfillment.courierName
            ? `<p><strong>Courier:</strong> ${fulfillment.courierName}</p>`
            : ''
        }
        ${
          fulfillment.trackingNumber
            ? `<p><strong>Tracking number:</strong> ${fulfillment.trackingNumber}</p>`
            : ''
        }
        ${
          fulfillment.trackingUrl
            ? `<p><strong>Tracking link:</strong> <a href="${fulfillment.trackingUrl}">${fulfillment.trackingUrl}</a></p>`
            : ''
        }
        ${fulfillment.packedAt ? `<p><strong>Packed at:</strong> ${fulfillment.packedAt.toISOString()}</p>` : ''}
        ${fulfillment.shippedAt ? `<p><strong>Shipped at:</strong> ${fulfillment.shippedAt.toISOString()}</p>` : ''}
        ${
          fulfillment.deliveredAt
            ? `<p><strong>Delivered at:</strong> ${fulfillment.deliveredAt.toISOString()}</p>`
            : ''
        }
        <p><a href="${orderDetailsUrl}">View your account orders</a></p>
      `,
    });
  } catch (error) {
    console.error('Failed to send order status notification email:', error);
  }
};

export const createOrder = async (
  req: Request<unknown, unknown, CreateOrderBody>,
  res: Response
): Promise<void> => {
  let idempotencyRecord: IIdempotencyRecord | undefined;

  try {
    const { shippingInfo, cartItems, couponCode, addressId } = req.body;
    const authReq = req as CustomerAuthRequest;
    const customerObjectId =
      authReq.customer?.id && mongoose.Types.ObjectId.isValid(authReq.customer.id)
        ? new mongoose.Types.ObjectId(authReq.customer.id)
        : null;

    const parsedIdempotencyKey = parseIdempotencyKey(req);

    if (parsedIdempotencyKey === '') {
      res.status(400).json({
        success: false,
        message:
          'Invalid idempotency key format. Use 8-200 chars with letters, numbers, dot, colon, underscore, or hyphen.',
      });
      return;
    }

    const idempotencyResult = await prepareIdempotencyRecord(
      parsedIdempotencyKey,
      createRequestHash(req.body),
      customerObjectId
    );

    if (idempotencyResult.replayResponse) {
      res.status(idempotencyResult.replayResponse.status).json(idempotencyResult.replayResponse.body);
      return;
    }

    if (idempotencyResult.errorResponse) {
      res.status(idempotencyResult.errorResponse.status).json(idempotencyResult.errorResponse.body);
      return;
    }

    idempotencyRecord = idempotencyResult.record;

    let sourceAddressId: mongoose.Types.ObjectId | null = null;
    let sourceAddressSnapshot: SourceAddressSnapshot | null = null;

    if (typeof addressId === 'string' && addressId.trim()) {
      const normalizedAddressId = addressId.trim();

      if (!customerObjectId) {
        await rollbackIdempotencyRecord(idempotencyRecord);
        res.status(401).json({
          success: false,
          message: 'You must be logged in to use a saved address',
        });
        return;
      }

      if (!mongoose.Types.ObjectId.isValid(normalizedAddressId)) {
        await rollbackIdempotencyRecord(idempotencyRecord);
        res.status(400).json({ success: false, message: 'Invalid address id' });
        return;
      }

      const selectedAddress = await Address.findOne({
        _id: normalizedAddressId,
        customer: customerObjectId,
      });

      if (!selectedAddress) {
        await rollbackIdempotencyRecord(idempotencyRecord);
        res.status(404).json({ success: false, message: 'Saved address not found' });
        return;
      }

      sourceAddressId = selectedAddress._id as mongoose.Types.ObjectId;
      sourceAddressSnapshot = buildSourceAddressSnapshot(selectedAddress);
    }

    const shippingValidation = validateShippingInfo(shippingInfo);
    if (!shippingValidation.valid) {
      await rollbackIdempotencyRecord(idempotencyRecord);
      res.status(400).json({ success: false, message: shippingValidation.message });
      return;
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      await rollbackIdempotencyRecord(idempotencyRecord);
      res.status(400).json({ success: false, message: 'Cart items are required' });
      return;
    }

    const normalizedItems: NormalizedOrderItemInput[] = cartItems.map((item) => ({
      productId: typeof item.productId === 'string' ? item.productId.trim() : '',
      quantity: Number(item.quantity),
      variantSku:
        typeof item.variantSku === 'string' && item.variantSku.trim()
          ? item.variantSku.trim()
          : null,
    }));

    const invalidItem = normalizedItems.find(
      (item) =>
        !mongoose.Types.ObjectId.isValid(item.productId) ||
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0 ||
        (item.variantSku !== null && item.variantSku.length > 120)
    );

    if (invalidItem) {
      await rollbackIdempotencyRecord(idempotencyRecord);
      res.status(400).json({ success: false, message: 'One or more cart items are invalid' });
      return;
    }

    const uniqueProductIds = [...new Set(normalizedItems.map((item) => item.productId))];
    const products = await Product.find({ _id: { $in: uniqueProductIds } });

    if (products.length !== uniqueProductIds.length) {
      await rollbackIdempotencyRecord(idempotencyRecord);
      res.status(400).json({ success: false, message: 'Some products were not found' });
      return;
    }

    const productMap = new Map(products.map((product) => [product._id.toString(), product]));
    const productNameById = new Map(products.map((product) => [product._id.toString(), product.name]));

    let subtotal = 0;
    const orderItems: OrderDocumentItem[] = [];
    const resolvedItemsForStock: NormalizedOrderItemInput[] = [];

    for (const item of normalizedItems) {
      const product = productMap.get(item.productId);

      if (!product) {
        await rollbackIdempotencyRecord(idempotencyRecord);
        res.status(400).json({ success: false, message: 'Product not found in cart' });
        return;
      }

      const productVariants = Array.isArray(product.variants) ? product.variants : [];
      const defaultVariant = productVariants.find((variant) => variant.isDefault) ?? productVariants[0];
      const selectedVariant =
        productVariants.length === 0
          ? null
          : item.variantSku
            ? productVariants.find((variant) => variant.sku === item.variantSku)
            : defaultVariant;

      if (productVariants.length > 0 && !selectedVariant) {
        await rollbackIdempotencyRecord(idempotencyRecord);
        res.status(400).json({
          success: false,
          message: `Selected variant was not found for ${product.name}`,
        });
        return;
      }

      const availableStock = selectedVariant ? selectedVariant.stockQuantity : product.stockQuantity;

      if (availableStock < item.quantity) {
        await rollbackIdempotencyRecord(idempotencyRecord);
        res.status(409).json({
          success: false,
          message: `Only ${availableStock} item(s) left for ${product.name}`,
        });
        return;
      }

      const unitPrice = selectedVariant ? selectedVariant.price : product.price;
      const lineSku = selectedVariant ? selectedVariant.sku : product.sku;
      const lineName = selectedVariant ? `${product.name} (${selectedVariant.label})` : product.name;

      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;

      orderItems.push({
        product: product._id as mongoose.Types.ObjectId,
        name: lineName,
        sku: lineSku,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
      });

      resolvedItemsForStock.push({
        productId: item.productId,
        quantity: item.quantity,
        variantSku: selectedVariant ? selectedVariant.sku : null,
      });
    }

    const normalizedCouponCode = typeof couponCode === 'string' ? couponCode.trim().toUpperCase() : '';
    let discountAmount = 0;
    let appliedCouponCode: string | null = null;
    let couponId: mongoose.Types.ObjectId | null = null;

    if (normalizedCouponCode) {
      const couponValidation = await validateCouponForOrder({
        code: normalizedCouponCode,
        subtotal,
        customerId: customerObjectId,
      });

      if (!couponValidation.valid) {
        await rollbackIdempotencyRecord(idempotencyRecord);
        res.status(400).json({
          success: false,
          message: couponValidation.message,
        });
        return;
      }

      discountAmount = couponValidation.discountAmount;
      appliedCouponCode = couponValidation.normalizedCode;
      couponId = couponValidation.coupon._id as mongoose.Types.ObjectId;
    }

    const safeShippingInfo = shippingInfo as ShippingInfoInput;
    const totalAmount = roundCurrency(Math.max(0, subtotal - discountAmount));
    const orderDocument: OrderDocumentInput = {
      customer: customerObjectId,
      shippingInfo: {
        fullName: safeShippingInfo.fullName.trim(),
        email: safeShippingInfo.email.trim().toLowerCase(),
        address: safeShippingInfo.address.trim(),
        city: safeShippingInfo.city.trim(),
        postalCode: safeShippingInfo.postalCode.trim(),
        phone: safeShippingInfo.phone.trim(),
      },
      sourceAddressId,
      sourceAddressSnapshot,
      items: orderItems,
      subtotal,
      discountAmount,
      couponCode: appliedCouponCode,
      shippingFee: 0,
      totalAmount,
      currency: 'INR',
      paymentStatus: 'pending',
      orderStatus: 'placed',
    };

    const order = await persistOrder({
      normalizedItems: resolvedItemsForStock,
      productNameById,
      orderDocument,
      couponId,
    });

    const successResponse: Record<string, unknown> = {
      success: true,
      message: 'Order created successfully',
      orderId: order._id,
      sourceAddressId: order.sourceAddressId ?? null,
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      couponCode: order.couponCode,
      totalAmount: order.totalAmount,
      paymentStatus: order.paymentStatus,
    };

    const orderId = order._id.toString();
    const adminOrdersUrl = getAdminConsoleOrdersUrl();
    void safeSendAdminNotificationEmail({
      eventType: 'order',
      subject: `New order placed: ${orderId}`,
      text: `A new order was placed.\nOrder ID: ${orderId}\nAmount: INR ${order.totalAmount}\nPayment status: ${order.paymentStatus}\nCustomer: ${order.shippingInfo.fullName} (${order.shippingInfo.email})\nPhone: ${order.shippingInfo.phone}\nItems: ${order.items.length}\nView in admin: ${adminOrdersUrl}`,
      html: `
        <p>A new order was placed.</p>
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p><strong>Amount:</strong> INR ${order.totalAmount}</p>
        <p><strong>Payment status:</strong> ${order.paymentStatus}</p>
        <p><strong>Customer:</strong> ${order.shippingInfo.fullName} (${order.shippingInfo.email})</p>
        <p><strong>Phone:</strong> ${order.shippingInfo.phone}</p>
        <p><strong>Items:</strong> ${order.items.length}</p>
        <p><a href="${adminOrdersUrl}">Open Admin Orders</a></p>
      `,
    });

    await completeIdempotencyRecord(idempotencyRecord, 201, successResponse);
    res.status(201).json(successResponse);
  } catch (error) {
    if (error instanceof OrderProcessingError) {
      await rollbackIdempotencyRecord(idempotencyRecord);
      res.status(error.statusCode).json({ success: false, message: error.message });
      return;
    }

    await rollbackIdempotencyRecord(idempotencyRecord);
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, message: 'Server Error during checkout' });
  }
};

export const getOrderById = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid order id' });
      return;
    }

    const order = await Order.findById(id).lean();

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const actor = (req as AuthContextRequest).auth;

    if (!canAccessOrder(order.customer, actor)) {
      res.status(403).json({ success: false, message: 'Forbidden: you cannot access this order' });
      return;
    }

    res.status(200).json({ success: true, order });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
};

export const getMyOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as CustomerAuthRequest;
    const customerId = authReq.customer?.id;

    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const query = req.query as GetMyOrdersQuery;
    const page = parsePositiveInteger(query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInteger(query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;

    const filters: QueryFilter<IOrder> = {
      customer: customerId,
    };

    if (query.orderStatus) {
      if (!ORDER_STATUSES.includes(query.orderStatus as (typeof ORDER_STATUSES)[number])) {
        res.status(400).json({
          success: false,
          message: `Invalid orderStatus. Allowed values: ${ORDER_STATUSES.join(', ')}`,
        });
        return;
      }

      filters.orderStatus = query.orderStatus;
    }

    if (query.paymentStatus) {
      if (!PAYMENT_STATUSES.includes(query.paymentStatus as (typeof PAYMENT_STATUSES)[number])) {
        res.status(400).json({
          success: false,
          message: `Invalid paymentStatus. Allowed values: ${PAYMENT_STATUSES.join(', ')}`,
        });
        return;
      }

      filters.paymentStatus = query.paymentStatus;
    }

    const createdAtFilterResult = buildCreatedAtFilter(query.fromDate, query.toDate);

    if (createdAtFilterResult.error) {
      res.status(400).json({ success: false, message: createdAtFilterResult.error });
      return;
    }

    if (createdAtFilterResult.filter) {
      filters.createdAt = createdAtFilterResult.filter;
    }

    const [orders, totalCount] = await Promise.all([
      Order.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(filters),
    ]);

    res.status(200).json({
      success: true,
      count: orders.length,
      totalCount,
      orders,
      pagination: buildPaginationMeta(page, limit, totalCount),
    });
  } catch (error) {
    console.error('Error fetching customer orders:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch your orders' });
  }
};

export const getOrders = async (
  req: Request<unknown, unknown, unknown, GetOrdersQuery>,
  res: Response
): Promise<void> => {
  try {
    const { limit, page } = req.query;

    const safePage = parsePositiveInteger(page, DEFAULT_PAGE);
    const safeLimit = Math.min(parsePositiveInteger(limit, DEFAULT_ADMIN_LIMIT), MAX_LIMIT);
    const skip = (safePage - 1) * safeLimit;

    const adminFiltersResult = buildAdminOrderFilters(req.query);

    if (adminFiltersResult.error || !adminFiltersResult.filters) {
      res.status(400).json({
        success: false,
        message: adminFiltersResult.error ?? 'Invalid order filters',
      });
      return;
    }

    const filters = adminFiltersResult.filters;

    const [orders, totalCount] = await Promise.all([
      Order.find(filters).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
      Order.countDocuments(filters),
    ]);

    res.status(200).json({
      success: true,
      count: orders.length,
      totalCount,
      orders,
      pagination: buildPaginationMeta(safePage, safeLimit, totalCount),
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
};

export const getRefundAnalytics = async (
  req: Request<unknown, unknown, unknown, GetOrdersQuery>,
  res: Response
): Promise<void> => {
  try {
    const adminFiltersResult = buildAdminOrderFilters(req.query);

    if (adminFiltersResult.error || !adminFiltersResult.filters) {
      res.status(400).json({
        success: false,
        message: adminFiltersResult.error ?? 'Invalid order filters',
      });
      return;
    }

    const [aggregateRow] = await Order.aggregate<{
      totalOrders: number;
      refundableOrders: number;
      notRequiredCount: number;
      pendingCount: number;
      processedCount: number;
      failedCount: number;
      pendingAmount: number;
      processedAmount: number;
      failedAmount: number;
      unknownSettlementCount: number;
      pendingSettlementCount: number;
      settledSettlementCount: number;
      failedSettlementCount: number;
    }>([
      {
        $match: adminFiltersResult.filters,
      },
      {
        $project: {
          refundStatus: { $ifNull: ['$refundInfo.status', 'not_required'] },
          refundAmount: { $ifNull: ['$refundInfo.amount', 0] },
          settlementStatus: { $ifNull: ['$refundInfo.gatewaySettlementStatus', 'unknown'] },
        },
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          refundableOrders: {
            $sum: {
              $cond: [
                { $in: ['$refundStatus', ['pending', 'processed', 'failed']] },
                1,
                0,
              ],
            },
          },
          notRequiredCount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'not_required'] }, 1, 0],
            },
          },
          pendingCount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'pending'] }, 1, 0],
            },
          },
          processedCount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'processed'] }, 1, 0],
            },
          },
          failedCount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'failed'] }, 1, 0],
            },
          },
          pendingAmount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'pending'] }, '$refundAmount', 0],
            },
          },
          processedAmount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'processed'] }, '$refundAmount', 0],
            },
          },
          failedAmount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'failed'] }, '$refundAmount', 0],
            },
          },
          unknownSettlementCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$refundStatus', ['pending', 'processed', 'failed']] },
                    { $eq: ['$settlementStatus', 'unknown'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          pendingSettlementCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$refundStatus', ['pending', 'processed', 'failed']] },
                    { $eq: ['$settlementStatus', 'pending'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          settledSettlementCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$refundStatus', ['pending', 'processed', 'failed']] },
                    { $eq: ['$settlementStatus', 'settled'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          failedSettlementCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$refundStatus', ['pending', 'processed', 'failed']] },
                    { $eq: ['$settlementStatus', 'failed'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalOrders: 1,
          refundableOrders: 1,
          notRequiredCount: 1,
          pendingCount: 1,
          processedCount: 1,
          failedCount: 1,
          pendingAmount: 1,
          processedAmount: 1,
          failedAmount: 1,
          unknownSettlementCount: 1,
          pendingSettlementCount: 1,
          settledSettlementCount: 1,
          failedSettlementCount: 1,
        },
      },
    ]);

    const analytics = aggregateRow ?? {
      totalOrders: 0,
      refundableOrders: 0,
      notRequiredCount: 0,
      pendingCount: 0,
      processedCount: 0,
      failedCount: 0,
      pendingAmount: 0,
      processedAmount: 0,
      failedAmount: 0,
      unknownSettlementCount: 0,
      pendingSettlementCount: 0,
      settledSettlementCount: 0,
      failedSettlementCount: 0,
    };

    const processedRate =
      analytics.refundableOrders > 0
        ? Math.round((analytics.processedCount / analytics.refundableOrders) * 10000) / 100
        : 0;
    const totalTrackedAmount = roundCurrency(
      analytics.pendingAmount + analytics.processedAmount + analytics.failedAmount
    );

    res.status(200).json({
      success: true,
      analytics: {
        totals: {
          totalOrders: analytics.totalOrders,
          refundableOrders: analytics.refundableOrders,
          totalTrackedAmount,
          processedRate,
        },
        statusBreakdown: {
          notRequiredCount: analytics.notRequiredCount,
          pendingCount: analytics.pendingCount,
          processedCount: analytics.processedCount,
          failedCount: analytics.failedCount,
        },
        amountBreakdown: {
          pendingAmount: roundCurrency(analytics.pendingAmount),
          processedAmount: roundCurrency(analytics.processedAmount),
          failedAmount: roundCurrency(analytics.failedAmount),
        },
        settlementBreakdown: {
          unknownCount: analytics.unknownSettlementCount,
          pendingCount: analytics.pendingSettlementCount,
          settledCount: analytics.settledSettlementCount,
          failedCount: analytics.failedSettlementCount,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching refund analytics:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch refund analytics' });
  }
};

export const exportRefundsCsv = async (
  req: Request<unknown, unknown, unknown, GetOrdersQuery>,
  res: Response
): Promise<void> => {
  try {
    const { limit } = req.query;
    const safeLimit = Math.min(parsePositiveInteger(limit, 1000), 5000);
    const adminFiltersResult = buildAdminOrderFilters(req.query);

    if (adminFiltersResult.error || !adminFiltersResult.filters) {
      res.status(400).json({
        success: false,
        message: adminFiltersResult.error ?? 'Invalid order filters',
      });
      return;
    }

    const filters: QueryFilter<IOrder> = {
      ...adminFiltersResult.filters,
    };

    if (!req.query.refundStatus) {
      filters['refundInfo.status'] = {
        $in: ['pending', 'processed', 'failed'],
      };
    }

    const orders = await Order.find(filters)
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean();

    const headers = [
      'order_id',
      'created_at',
      'customer_name',
      'customer_email',
      'payment_status',
      'order_status',
      'refund_status',
      'refund_amount',
      'refund_currency',
      'refund_initiated_at',
      'refund_processed_at',
      'refund_reference',
      'refund_note',
      'gateway_refund_id',
      'gateway_settlement_status',
      'gateway_settlement_at',
    ];

    const rows = orders.map((order) => {
      const refund = order.refundInfo ?? {
        status: 'not_required',
        amount: 0,
        currency: 'INR',
      };

      const values = [
        order._id,
        order.createdAt,
        order.shippingInfo?.fullName ?? '',
        order.shippingInfo?.email ?? '',
        order.paymentStatus,
        order.orderStatus,
        refund.status ?? 'not_required',
        typeof refund.amount === 'number' ? refund.amount : 0,
        refund.currency ?? 'INR',
        refund.initiatedAt ?? '',
        refund.processedAt ?? '',
        refund.reference ?? '',
        refund.note ?? '',
        refund.gatewayRefundId ?? '',
        refund.gatewaySettlementStatus ?? 'unknown',
        refund.gatewaySettlementAt ?? '',
      ];

      return values.map((value) => csvEscape(value)).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const filename = `refunds-${toCsvTimestampLabel(new Date())}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (error) {
    console.error('Error exporting refunds CSV:', error);
    res.status(500).json({ success: false, message: 'Failed to export refunds CSV' });
  }
};

export const exportRefundTrendCsv = async (
  req: Request<unknown, unknown, unknown, GetOrdersQuery>,
  res: Response
): Promise<void> => {
  try {
    const adminFiltersResult = buildAdminOrderFilters(req.query);

    if (adminFiltersResult.error || !adminFiltersResult.filters) {
      res.status(400).json({
        success: false,
        message: adminFiltersResult.error ?? 'Invalid order filters',
      });
      return;
    }

    const filters: QueryFilter<IOrder> = {
      ...adminFiltersResult.filters,
    };

    if (!req.query.refundStatus) {
      filters['refundInfo.status'] = {
        $in: ['pending', 'processed', 'failed'],
      };
    }

    const rows = await Order.aggregate<{
      date: string;
      totalCount: number;
      pendingCount: number;
      processedCount: number;
      failedCount: number;
      pendingAmount: number;
      processedAmount: number;
      failedAmount: number;
      totalAmount: number;
    }>([
      {
        $match: filters,
      },
      {
        $project: {
          refundStatus: { $ifNull: ['$refundInfo.status', 'not_required'] },
          refundAmount: { $ifNull: ['$refundInfo.amount', 0] },
          refundDate: { $ifNull: ['$refundInfo.initiatedAt', '$createdAt'] },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$refundDate',
              timezone: 'UTC',
            },
          },
          totalCount: { $sum: 1 },
          pendingCount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'pending'] }, 1, 0],
            },
          },
          processedCount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'processed'] }, 1, 0],
            },
          },
          failedCount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'failed'] }, 1, 0],
            },
          },
          pendingAmount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'pending'] }, '$refundAmount', 0],
            },
          },
          processedAmount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'processed'] }, '$refundAmount', 0],
            },
          },
          failedAmount: {
            $sum: {
              $cond: [{ $eq: ['$refundStatus', 'failed'] }, '$refundAmount', 0],
            },
          },
          totalAmount: { $sum: '$refundAmount' },
        },
      },
      {
        $project: {
          _id: 0,
          date: '$_id',
          totalCount: 1,
          pendingCount: 1,
          processedCount: 1,
          failedCount: 1,
          pendingAmount: 1,
          processedAmount: 1,
          failedAmount: 1,
          totalAmount: 1,
        },
      },
      {
        $sort: {
          date: 1,
        },
      },
    ]);

    const headers = [
      'date',
      'total_refund_orders',
      'pending_count',
      'processed_count',
      'failed_count',
      'pending_amount',
      'processed_amount',
      'failed_amount',
      'total_amount',
    ];

    const csvRows = rows.map((row) =>
      [
        row.date,
        row.totalCount,
        row.pendingCount,
        row.processedCount,
        row.failedCount,
        roundCurrency(row.pendingAmount),
        roundCurrency(row.processedAmount),
        roundCurrency(row.failedAmount),
        roundCurrency(row.totalAmount),
      ]
        .map((value) => csvEscape(value))
        .join(',')
    );

    const csvContent = [headers.join(','), ...csvRows].join('\n');
    const filename = `refund-trend-${toCsvTimestampLabel(new Date())}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (error) {
    console.error('Error exporting refund trend CSV:', error);
    res.status(500).json({ success: false, message: 'Failed to export refund trend CSV' });
  }
};

export const requestOrderCancellation = async (
  req: Request<{ id: string }, unknown, RequestOrderCancellationBody>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const authReq = req as CustomerAuthRequest;
    const customerId = authReq.customer?.id;
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      await logAuditEvent(req, {
        action: 'orders.cancellation.request',
        outcome: 'failure',
        statusCode: 401,
        resourceType: 'order',
        resourceId: id,
        metadata: { reason: 'unauthorized' },
      });
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await logAuditEvent(req, {
        action: 'orders.cancellation.request',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'order',
        resourceId: id,
        metadata: { reason: 'invalid_order_id' },
      });
      res.status(400).json({ success: false, message: 'Invalid order id' });
      return;
    }

    if (!reason) {
      res.status(400).json({ success: false, message: 'Cancellation reason is required' });
      return;
    }

    if (reason.length > CANCELLATION_REASON_MAX_LENGTH) {
      res.status(400).json({
        success: false,
        message: `Cancellation reason must be ${CANCELLATION_REASON_MAX_LENGTH} characters or less`,
      });
      return;
    }

    const order = await Order.findById(id);

    if (!order) {
      await logAuditEvent(req, {
        action: 'orders.cancellation.request',
        outcome: 'failure',
        statusCode: 404,
        resourceType: 'order',
        resourceId: id,
        metadata: { reason: 'order_not_found' },
      });
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const actor: AuthActor = {
      id: customerId,
      role: 'customer',
      email: authReq.customer?.email ?? '',
    };

    if (!canAccessOrder(order.customer, actor)) {
      await logAuditEvent(req, {
        action: 'orders.cancellation.request',
        outcome: 'failure',
        statusCode: 403,
        resourceType: 'order',
        resourceId: id,
        metadata: { reason: 'forbidden' },
      });
      res.status(403).json({ success: false, message: 'Forbidden: you cannot access this order' });
      return;
    }

    if (!canCustomerRequestCancellation(order.orderStatus)) {
      res.status(409).json({
        success: false,
        message: 'Cancellation request is allowed only for placed or processing orders',
      });
      return;
    }

    if (getCancellationState(order).status === 'requested') {
      res.status(409).json({ success: false, message: 'Cancellation request already submitted' });
      return;
    }

    order.cancellationRequest = {
      status: 'requested',
      reason,
      requestedAt: new Date(),
      requestedBy: new mongoose.Types.ObjectId(customerId),
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: null,
    };

    await order.save();

    await logAuditEvent(req, {
      action: 'orders.cancellation.request',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'order',
      resourceId: order._id.toString(),
      metadata: {
        orderStatus: order.orderStatus,
        reasonLength: reason.length,
      },
    });

    await safeSendOrderCancellationEmail(order, 'requested');

    res.status(200).json({
      success: true,
      message: 'Cancellation request submitted',
      orderId: order._id,
      cancellationRequest: getCancellationState(order),
    });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'orders.cancellation.request',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'order',
      resourceId: req.params.id,
      metadata: { reason: 'unexpected_error' },
    });
    console.error('Error requesting order cancellation:', error);
    res.status(500).json({ success: false, message: 'Failed to request cancellation' });
  }
};

export const reviewOrderCancellation = async (
  req: Request<{ id: string }, unknown, ReviewOrderCancellationBody>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const action = req.body.action;
    const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
    const adminId = (req as Request & { admin?: { id: string } }).admin?.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await logAuditEvent(req, {
        action: 'orders.cancellation.review',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'order',
        resourceId: id,
        metadata: { reason: 'invalid_order_id' },
      });
      res.status(400).json({ success: false, message: 'Invalid order id' });
      return;
    }

    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ success: false, message: 'action must be one of: approve, reject' });
      return;
    }

    if (note.length > CANCELLATION_NOTE_MAX_LENGTH) {
      res.status(400).json({
        success: false,
        message: `note must be ${CANCELLATION_NOTE_MAX_LENGTH} characters or less`,
      });
      return;
    }

    const order = await Order.findById(id);

    if (!order) {
      await logAuditEvent(req, {
        action: 'orders.cancellation.review',
        outcome: 'failure',
        statusCode: 404,
        resourceType: 'order',
        resourceId: id,
        metadata: { reason: 'order_not_found' },
      });
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const currentCancellationState = getCancellationState(order);

    if (currentCancellationState.status !== 'requested') {
      res.status(409).json({
        success: false,
        message: 'No pending cancellation request found for this order',
      });
      return;
    }

    const reviewedAt = new Date();
    const reviewedBy =
      adminId && mongoose.Types.ObjectId.isValid(adminId) ? new mongoose.Types.ObjectId(adminId) : null;

    let shouldNotifyRefundPending = false;

    if (action === 'approve') {
      if (order.orderStatus !== 'cancelled') {
        await restoreOrderStock(order);
      }

      order.orderStatus = 'cancelled';
      order.cancellationRequest = {
        ...currentCancellationState,
        status: 'approved',
        reviewedAt,
        reviewedBy,
        reviewNote: note || null,
      };

      const previousRefundStatus = getRefundState(order).status;
      markRefundPendingIfRequired(order, reviewedBy, 'Refund initiated after cancellation approval');
      shouldNotifyRefundPending =
        order.paymentStatus === 'paid' &&
        previousRefundStatus !== 'pending' &&
        getRefundState(order).status === 'pending';
    } else {
      order.cancellationRequest = {
        ...currentCancellationState,
        status: 'rejected',
        reviewedAt,
        reviewedBy,
        reviewNote: note || null,
      };
    }

    await order.save();

    await logAuditEvent(req, {
      action: 'orders.cancellation.review',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'order',
      resourceId: order._id.toString(),
      metadata: {
        action,
        nextStatus: order.orderStatus,
      },
    });

    await safeSendOrderCancellationEmail(order, action === 'approve' ? 'approved' : 'rejected', note || null);

    if (shouldNotifyRefundPending) {
      await safeSendRefundStatusEmail(order, 'pending');
    }

    res.status(200).json({
      success: true,
      message: action === 'approve' ? 'Cancellation approved successfully' : 'Cancellation rejected successfully',
      orderId: order._id,
      orderStatus: order.orderStatus,
      cancellationRequest: getCancellationState(order),
      refundInfo: getRefundState(order),
    });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'orders.cancellation.review',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'order',
      resourceId: req.params.id,
      metadata: { reason: 'unexpected_error' },
    });
    console.error('Error reviewing cancellation request:', error);
    res.status(500).json({ success: false, message: 'Failed to review cancellation request' });
  }
};

export const updateOrderRefund = async (
  req: Request<{ id: string }, unknown, UpdateOrderRefundBody>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
    const reference = typeof req.body.reference === 'string' ? req.body.reference.trim() : '';
    const hasGatewayRefundId = req.body.gatewayRefundId !== undefined;
    const hasGatewaySettlementStatus = req.body.gatewaySettlementStatus !== undefined;
    const hasGatewaySettlementAt = req.body.gatewaySettlementAt !== undefined;
    const gatewayRefundId =
      typeof req.body.gatewayRefundId === 'string' ? req.body.gatewayRefundId.trim() : '';
    const gatewaySettlementStatus = req.body.gatewaySettlementStatus;
    const gatewaySettlementAt = req.body.gatewaySettlementAt;
    const rawAmount = req.body.amount;
    const adminId = (req as Request & { admin?: { id: string } }).admin?.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await logAuditEvent(req, {
        action: 'orders.refund.update',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'order',
        resourceId: id,
        metadata: { reason: 'invalid_order_id' },
      });
      res.status(400).json({ success: false, message: 'Invalid order id' });
      return;
    }

    if (status !== 'pending' && status !== 'processed' && status !== 'failed') {
      res.status(400).json({ success: false, message: 'status must be one of: pending, processed, failed' });
      return;
    }

    if (reference.length > REFUND_REFERENCE_MAX_LENGTH) {
      res.status(400).json({
        success: false,
        message: `reference must be ${REFUND_REFERENCE_MAX_LENGTH} characters or less`,
      });
      return;
    }

    if (note.length > REFUND_NOTE_MAX_LENGTH) {
      res.status(400).json({
        success: false,
        message: `note must be ${REFUND_NOTE_MAX_LENGTH} characters or less`,
      });
      return;
    }

    if (gatewayRefundId.length > REFUND_GATEWAY_ID_MAX_LENGTH) {
      res.status(400).json({
        success: false,
        message: `gatewayRefundId must be ${REFUND_GATEWAY_ID_MAX_LENGTH} characters or less`,
      });
      return;
    }

    if (
      hasGatewaySettlementStatus &&
      gatewaySettlementStatus !== 'unknown' &&
      gatewaySettlementStatus !== 'pending' &&
      gatewaySettlementStatus !== 'settled' &&
      gatewaySettlementStatus !== 'failed'
    ) {
      res.status(400).json({
        success: false,
        message: 'gatewaySettlementStatus must be one of: unknown, pending, settled, failed',
      });
      return;
    }

    let parsedGatewaySettlementAt: Date | null = null;

    if (!hasGatewaySettlementAt) {
      parsedGatewaySettlementAt = null;
    } else if (typeof gatewaySettlementAt === 'string' && gatewaySettlementAt.trim()) {
      const parsed = new Date(gatewaySettlementAt.trim());

      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({
          success: false,
          message: 'gatewaySettlementAt must be a valid date-time string',
        });
        return;
      }

      parsedGatewaySettlementAt = parsed;
    } else if (gatewaySettlementAt === null || gatewaySettlementAt === '') {
      parsedGatewaySettlementAt = null;
    } else {
      res.status(400).json({
        success: false,
        message: 'gatewaySettlementAt must be a date-time string or null',
      });
      return;
    }

    const order = await Order.findById(id);

    if (!order) {
      await logAuditEvent(req, {
        action: 'orders.refund.update',
        outcome: 'failure',
        statusCode: 404,
        resourceType: 'order',
        resourceId: id,
        metadata: { reason: 'order_not_found' },
      });
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    if (order.orderStatus !== 'cancelled') {
      res.status(409).json({
        success: false,
        message: 'Refund updates are allowed only for cancelled orders',
      });
      return;
    }

    if (order.paymentStatus !== 'paid') {
      res.status(409).json({
        success: false,
        message: 'Refund is not required because this order is not paid',
      });
      return;
    }

    let nextAmount = getRefundState(order).amount > 0 ? getRefundState(order).amount : order.totalAmount;

    if (rawAmount !== undefined) {
      const parsedAmount = Number(rawAmount);

      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        res.status(400).json({ success: false, message: 'amount must be a positive number' });
        return;
      }

      if (parsedAmount > order.totalAmount) {
        res.status(400).json({
          success: false,
          message: 'amount cannot exceed order total amount',
        });
        return;
      }

      nextAmount = roundCurrency(parsedAmount);
    }

    const now = new Date();
    const updatedBy =
      adminId && mongoose.Types.ObjectId.isValid(adminId)
        ? new mongoose.Types.ObjectId(adminId)
        : null;
    const currentRefund = getRefundState(order);
    const nextGatewaySettlementStatus: RefundStateSnapshot['gatewaySettlementStatus'] =
      !hasGatewaySettlementStatus
        ? currentRefund.gatewaySettlementStatus
        : gatewaySettlementStatus ?? 'unknown';

    order.refundInfo = {
      ...currentRefund,
      status,
      amount: nextAmount,
      currency: 'INR',
      initiatedAt: status === 'pending' ? currentRefund.initiatedAt ?? now : currentRefund.initiatedAt ?? now,
      processedAt: status === 'processed' ? now : null,
      updatedBy,
      reference: reference || null,
      note: note || null,
      gatewayRefundId: hasGatewayRefundId ? (gatewayRefundId || null) : currentRefund.gatewayRefundId,
      gatewaySettlementStatus: nextGatewaySettlementStatus,
      gatewaySettlementAt:
        nextGatewaySettlementStatus === 'settled'
          ? hasGatewaySettlementAt
            ? parsedGatewaySettlementAt ?? currentRefund.gatewaySettlementAt ?? now
            : currentRefund.gatewaySettlementAt ?? now
          : hasGatewaySettlementAt
            ? parsedGatewaySettlementAt
            : currentRefund.gatewaySettlementAt,
    };

    await order.save();

    await logAuditEvent(req, {
      action: 'orders.refund.update',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'order',
      resourceId: order._id.toString(),
      metadata: {
        status,
        amount: nextAmount,
      },
    });

    await safeSendRefundStatusEmail(order, status);

    res.status(200).json({
      success: true,
      message: 'Refund status updated successfully',
      orderId: order._id,
      refundInfo: getRefundState(order),
    });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'orders.refund.update',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'order',
      resourceId: req.params.id,
      metadata: { reason: 'unexpected_error' },
    });
    console.error('Error updating refund status:', error);
    res.status(500).json({ success: false, message: 'Failed to update refund status' });
  }
};

export const updateOrderStatus = async (
  req: Request<{ id: string }, unknown, UpdateOrderStatusBody>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const nextStatus = req.body.orderStatus?.trim();
    const fulfillmentInput = req.body.fulfillment;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await logAuditEvent(req, {
        action: 'orders.status.update',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'order',
        resourceId: id,
        metadata: { reason: 'invalid_order_id' },
      });
      res.status(400).json({ success: false, message: 'Invalid order id' });
      return;
    }

    if (!nextStatus || !ORDER_STATUSES.includes(nextStatus as (typeof ORDER_STATUSES)[number])) {
      await logAuditEvent(req, {
        action: 'orders.status.update',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'order',
        resourceId: id,
        metadata: { reason: 'invalid_order_status' },
      });
      res.status(400).json({
        success: false,
        message: `Invalid order status. Allowed values: ${ORDER_STATUSES.join(', ')}`,
      });
      return;
    }

    if (
      fulfillmentInput !== undefined &&
      (typeof fulfillmentInput !== 'object' || fulfillmentInput === null || Array.isArray(fulfillmentInput))
    ) {
      res.status(400).json({
        success: false,
        message: 'fulfillment must be an object when provided',
      });
      return;
    }

    const courierNameResult = parseOptionalStringField(
      fulfillmentInput?.courierName,
      'fulfillment.courierName',
      FULFILLMENT_TEXT_MAX_LENGTH
    );
    const trackingNumberResult = parseOptionalStringField(
      fulfillmentInput?.trackingNumber,
      'fulfillment.trackingNumber',
      FULFILLMENT_TEXT_MAX_LENGTH
    );
    const trackingUrlResult = parseOptionalStringField(
      fulfillmentInput?.trackingUrl,
      'fulfillment.trackingUrl',
      FULFILLMENT_URL_MAX_LENGTH
    );
    const packedAtResult = parseOptionalDateTimeField(fulfillmentInput?.packedAt, 'fulfillment.packedAt');
    const shippedAtResult = parseOptionalDateTimeField(fulfillmentInput?.shippedAt, 'fulfillment.shippedAt');
    const deliveredAtResult = parseOptionalDateTimeField(
      fulfillmentInput?.deliveredAt,
      'fulfillment.deliveredAt'
    );

    const parseError =
      courierNameResult.error ??
      trackingNumberResult.error ??
      trackingUrlResult.error ??
      packedAtResult.error ??
      shippedAtResult.error ??
      deliveredAtResult.error;

    if (parseError) {
      res.status(400).json({ success: false, message: parseError });
      return;
    }

    if (trackingUrlResult.value) {
      let parsedTrackingUrl: URL;
      try {
        parsedTrackingUrl = new URL(trackingUrlResult.value);
      } catch {
        res.status(400).json({
          success: false,
          message: 'fulfillment.trackingUrl must be a valid http(s) URL',
        });
        return;
      }

      if (parsedTrackingUrl.protocol !== 'http:' && parsedTrackingUrl.protocol !== 'https:') {
        res.status(400).json({
          success: false,
          message: 'fulfillment.trackingUrl must use http or https protocol',
        });
        return;
      }
    }

    const order = await Order.findById(id);

    if (!order) {
      await logAuditEvent(req, {
        action: 'orders.status.update',
        outcome: 'failure',
        statusCode: 404,
        resourceType: 'order',
        resourceId: id,
        metadata: { reason: 'order_not_found' },
      });
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const previousStatus = order.orderStatus;
    const normalizedNextStatus = nextStatus as (typeof ORDER_STATUSES)[number];

    if (previousStatus === 'cancelled' && normalizedNextStatus !== 'cancelled') {
      res.status(409).json({
        success: false,
        message: 'Cancelled orders cannot be moved to another status',
      });
      return;
    }

    if (previousStatus === 'delivered' && normalizedNextStatus === 'cancelled') {
      res.status(409).json({
        success: false,
        message: 'Delivered orders cannot be cancelled',
      });
      return;
    }

    if (previousStatus !== 'cancelled' && normalizedNextStatus === 'cancelled') {
      await restoreOrderStock(order);
    }

    order.orderStatus = normalizedNextStatus;
    const previousFulfillment = getFulfillmentState(order);
    const nextFulfillment: FulfillmentStateSnapshot = { ...previousFulfillment };

    if (courierNameResult.isProvided) {
      nextFulfillment.courierName = courierNameResult.value;
    }

    if (trackingNumberResult.isProvided) {
      nextFulfillment.trackingNumber = trackingNumberResult.value;
    }

    if (trackingUrlResult.isProvided) {
      nextFulfillment.trackingUrl = trackingUrlResult.value;
    }

    if (packedAtResult.isProvided) {
      nextFulfillment.packedAt = packedAtResult.value;
    }

    if (shippedAtResult.isProvided) {
      nextFulfillment.shippedAt = shippedAtResult.value;
    }

    if (deliveredAtResult.isProvided) {
      nextFulfillment.deliveredAt = deliveredAtResult.value;
    }

    const statusTransitionTimestamp = new Date();

    if (normalizedNextStatus === 'processing' && !nextFulfillment.packedAt) {
      nextFulfillment.packedAt = statusTransitionTimestamp;
    }

    if (normalizedNextStatus === 'shipped') {
      if (!nextFulfillment.shippedAt) {
        nextFulfillment.shippedAt = statusTransitionTimestamp;
      }
      if (!nextFulfillment.packedAt) {
        nextFulfillment.packedAt = nextFulfillment.shippedAt;
      }
    }

    if (normalizedNextStatus === 'delivered') {
      if (!nextFulfillment.deliveredAt) {
        nextFulfillment.deliveredAt = statusTransitionTimestamp;
      }
      if (!nextFulfillment.shippedAt) {
        nextFulfillment.shippedAt = nextFulfillment.deliveredAt;
      }
      if (!nextFulfillment.packedAt) {
        nextFulfillment.packedAt = nextFulfillment.shippedAt;
      }
    }

    const fulfillmentUpdated =
      previousFulfillment.courierName !== nextFulfillment.courierName ||
      previousFulfillment.trackingNumber !== nextFulfillment.trackingNumber ||
      previousFulfillment.trackingUrl !== nextFulfillment.trackingUrl ||
      !areNullableDatesEqual(previousFulfillment.packedAt, nextFulfillment.packedAt) ||
      !areNullableDatesEqual(previousFulfillment.shippedAt, nextFulfillment.shippedAt) ||
      !areNullableDatesEqual(previousFulfillment.deliveredAt, nextFulfillment.deliveredAt);

    order.fulfillmentInfo = nextFulfillment;

    const currentCancellationState = getCancellationState(order);

    let shouldNotifyCancellationApproval = false;
    let cancellationApprovalNote: string | null = null;
    let shouldNotifyRefundPending = false;

    if (currentCancellationState.status === 'requested' && normalizedNextStatus === 'cancelled') {
      const adminId = (req as Request & { admin?: { id: string } }).admin?.id;
      const reviewedByObjectId =
        adminId && mongoose.Types.ObjectId.isValid(adminId)
          ? new mongoose.Types.ObjectId(adminId)
          : null;

      cancellationApprovalNote = currentCancellationState.reviewNote || 'Approved via direct status update';
      order.cancellationRequest = {
        ...currentCancellationState,
        status: 'approved',
        reviewedAt: new Date(),
        reviewedBy: reviewedByObjectId,
        reviewNote: cancellationApprovalNote,
      };
      shouldNotifyCancellationApproval = true;

      const previousRefundStatus = getRefundState(order).status;
      markRefundPendingIfRequired(order, reviewedByObjectId, 'Refund initiated after cancellation approval');
      shouldNotifyRefundPending =
        order.paymentStatus === 'paid' &&
        previousRefundStatus !== 'pending' &&
        getRefundState(order).status === 'pending';
    } else if (normalizedNextStatus === 'cancelled') {
      const adminId = (req as Request & { admin?: { id: string } }).admin?.id;
      const reviewedByObjectId =
        adminId && mongoose.Types.ObjectId.isValid(adminId)
          ? new mongoose.Types.ObjectId(adminId)
          : null;
      const previousRefundStatus = getRefundState(order).status;
      markRefundPendingIfRequired(order, reviewedByObjectId, 'Refund initiated after manual cancellation');
      shouldNotifyRefundPending =
        order.paymentStatus === 'paid' &&
        previousRefundStatus !== 'pending' &&
        getRefundState(order).status === 'pending';
    }

    await order.save();
    await logAuditEvent(req, {
      action: 'orders.status.update',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'order',
      resourceId: order._id.toString(),
      metadata: {
        previousStatus,
        nextStatus: order.orderStatus,
        fulfillmentUpdated,
        hasTrackingNumber: Boolean(nextFulfillment.trackingNumber),
      },
    });

    if (shouldNotifyCancellationApproval) {
      await safeSendOrderCancellationEmail(order, 'approved', cancellationApprovalNote);
    }

    if (shouldNotifyRefundPending) {
      await safeSendRefundStatusEmail(order, 'pending');
    }

    const shouldNotifyOrderStatus =
      order.orderStatus !== 'cancelled' && (previousStatus !== order.orderStatus || fulfillmentUpdated);

    if (shouldNotifyOrderStatus) {
      await safeSendOrderStatusEmail(order, previousStatus, order.orderStatus);
    }

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      orderId: order._id,
      orderStatus: order.orderStatus,
      refundInfo: getRefundState(order),
      fulfillmentInfo: getFulfillmentState(order),
    });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'orders.status.update',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'order',
      resourceId: req.params.id,
      metadata: { reason: 'unexpected_error' },
    });
    console.error('Error updating order status:', error);
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
};
