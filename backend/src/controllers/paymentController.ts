import type { Request, Response } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';
import Razorpay from 'razorpay';
import env from '../config/env.js';
import IdempotencyRecord, { type IIdempotencyRecord } from '../models/IdempotencyRecord.js';
import Order, { type IOrder } from '../models/Order.js';
import PaymentWebhookEvent from '../models/PaymentWebhookEvent.js';
import User from '../models/User.js';
import type { AuthActor, AuthContextRequest } from '../middleware/authContext.js';
import {
  getAdminConsoleOrdersUrl,
  getAdminConsolePaymentsUrl,
  safeSendAdminNotificationEmail,
} from '../services/adminNotificationService.js';

interface CreatePaymentOrderBody {
  orderId?: string;
}

interface VerifyPaymentBody {
  orderId?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
}

interface WebhookEventsQuery {
  status?: 'processing' | 'processed' | 'failed';
  eventType?: string;
  search?: string;
  limit?: string;
}

interface RazorpayWebhookPayload {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        status?: string;
      };
    };
    order?: {
      entity?: {
        id?: string;
      };
    };
    refund?: {
      entity?: {
        id?: string;
        order_id?: string;
        payment_id?: string;
        status?: string;
      };
    };
  };
}

const PAYMENT_VERIFY_IDEMPOTENCY_SCOPE = 'payment_verify' as const;
const IDEMPOTENCY_KEY_HEADER = 'x-idempotency-key';

const parsePaymentIdempotencyTtlHours = (): number => {
  const raw = process.env.PAYMENT_VERIFY_IDEMPOTENCY_TTL_HOURS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 168) {
    return 24;
  }

  return parsed;
};

const parsePaymentIdempotencyLockSeconds = (): number => {
  const raw = process.env.PAYMENT_VERIFY_IDEMPOTENCY_LOCK_SECONDS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 300) {
    return 120;
  }

  return parsed;
};

const PAYMENT_VERIFY_IDEMPOTENCY_TTL_HOURS = parsePaymentIdempotencyTtlHours();
const PAYMENT_VERIFY_IDEMPOTENCY_LOCK_SECONDS = parsePaymentIdempotencyLockSeconds();

const getRazorpayConfig = (): { keyId: string; keySecret: string } | null => {
  const keyId = env.razorpayKeyId;
  const keySecret = env.razorpayKeySecret;

  if (!keyId || !keySecret) {
    return null;
  }

  return { keyId, keySecret };
};

const createRazorpayClient = (keyId: string, keySecret: string): Razorpay => {
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
};

const getWebhookSecret = (): string | null => {
  return env.razorpayWebhookSecret;
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

const createRequestHash = (body: Record<string, string>): string => {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
};

const deriveVerifyIdempotencyKey = (requestHash: string): string => {
  return `pv:${requestHash}`;
};

const ensureRefundPendingForCancelledPaidOrder = (order: IOrder): void => {
  if (order.orderStatus !== 'cancelled' || order.paymentStatus !== 'paid') {
    return;
  }

  const currentStatus = order.refundInfo?.status ?? 'not_required';

  if (currentStatus === 'processed') {
    return;
  }

  order.refundInfo = {
    status: 'pending',
    amount:
      typeof order.refundInfo?.amount === 'number' && order.refundInfo.amount > 0
        ? order.refundInfo.amount
        : order.totalAmount,
    currency: 'INR',
    initiatedAt: order.refundInfo?.initiatedAt ?? new Date(),
    processedAt: null,
    updatedBy: order.refundInfo?.updatedBy ?? null,
    reference: order.refundInfo?.reference ?? null,
    note: order.refundInfo?.note ?? 'Payment captured after cancellation; refund pending',
    gatewayRefundId: order.refundInfo?.gatewayRefundId ?? null,
    gatewaySettlementStatus: order.refundInfo?.gatewaySettlementStatus ?? 'unknown',
    gatewaySettlementAt: order.refundInfo?.gatewaySettlementAt ?? null,
  };
};

const resolveGatewaySettlementStatusFromWebhook = (
  eventType: string,
  gatewayRefundStatus: string | undefined
): 'pending' | 'settled' | 'failed' | null => {
  const normalizedEventType = eventType.trim().toLowerCase();
  const normalizedRefundStatus = gatewayRefundStatus?.trim().toLowerCase();

  if (normalizedEventType === 'refund.processed' || normalizedRefundStatus === 'processed') {
    return 'settled';
  }

  if (normalizedEventType === 'refund.failed' || normalizedRefundStatus === 'failed') {
    return 'failed';
  }

  if (
    normalizedEventType.startsWith('refund.') ||
    normalizedRefundStatus === 'created' ||
    normalizedRefundStatus === 'pending' ||
    normalizedRefundStatus === 'queued' ||
    normalizedRefundStatus === 'initiated'
  ) {
    return 'pending';
  }

  return null;
};

const applyGatewaySettlementUpdate = (
  order: IOrder,
  settlementStatus: 'pending' | 'settled' | 'failed',
  gatewayRefundId: string | null
): void => {
  const currentRefundInfo = order.refundInfo;
  const currentSettlementStatus = currentRefundInfo?.gatewaySettlementStatus ?? 'unknown';

  const nextSettlementStatus =
    currentSettlementStatus === 'settled' && settlementStatus !== 'settled'
      ? 'settled'
      : settlementStatus;

  const nextSettlementAt =
    nextSettlementStatus === 'settled'
      ? currentRefundInfo?.gatewaySettlementAt ?? new Date()
      : currentSettlementStatus === 'settled'
        ? currentRefundInfo?.gatewaySettlementAt ?? null
        : null;

  order.refundInfo = {
    status: currentRefundInfo?.status ?? 'not_required',
    amount:
      typeof currentRefundInfo?.amount === 'number' && currentRefundInfo.amount > 0
        ? currentRefundInfo.amount
        : order.totalAmount,
    currency: currentRefundInfo?.currency ?? 'INR',
    initiatedAt: currentRefundInfo?.initiatedAt ?? null,
    processedAt: currentRefundInfo?.processedAt ?? null,
    updatedBy: currentRefundInfo?.updatedBy ?? null,
    reference: currentRefundInfo?.reference ?? null,
    note: currentRefundInfo?.note ?? null,
    gatewayRefundId: gatewayRefundId ?? currentRefundInfo?.gatewayRefundId ?? null,
    gatewaySettlementStatus: nextSettlementStatus,
    gatewaySettlementAt: nextSettlementAt,
  };
};

const safeSendAdminPaymentEventEmail = async (input: {
  order: IOrder;
  title: string;
  summary: string;
  includeSettlementDetails?: boolean;
}): Promise<void> => {
  const orderId = input.order._id.toString();
  const adminOrdersUrl = getAdminConsoleOrdersUrl();
  const adminPaymentsUrl = getAdminConsolePaymentsUrl();
  const settlementStatus = input.order.refundInfo?.gatewaySettlementStatus ?? 'unknown';
  const settlementAt = input.order.refundInfo?.gatewaySettlementAt?.toISOString() ?? 'n/a';
  const gatewayRefundId = input.order.refundInfo?.gatewayRefundId ?? 'n/a';
  const settlementLines = input.includeSettlementDetails
    ? `\nSettlement status: ${settlementStatus}\nGateway refund id: ${gatewayRefundId}\nSettlement at: ${settlementAt}`
    : '';
  const settlementHtml = input.includeSettlementDetails
    ? `<p><strong>Settlement status:</strong> ${settlementStatus}</p>
       <p><strong>Gateway refund id:</strong> ${gatewayRefundId}</p>
       <p><strong>Settlement at:</strong> ${settlementAt}</p>`
    : '';

  await safeSendAdminNotificationEmail({
    eventType: 'payment',
    subject: `${input.title}: ${orderId}`,
    text: `${input.summary}\nOrder ID: ${orderId}\nAmount: INR ${input.order.totalAmount}\nPayment status: ${input.order.paymentStatus}\nOrder status: ${input.order.orderStatus}\nRazorpay order id: ${input.order.razorpayOrderId ?? 'n/a'}\nRazorpay payment id: ${input.order.razorpayPaymentId ?? 'n/a'}${settlementLines}\nOpen orders: ${adminOrdersUrl}\nOpen payments: ${adminPaymentsUrl}`,
    html: `
      <p>${input.summary}</p>
      <p><strong>Order ID:</strong> ${orderId}</p>
      <p><strong>Amount:</strong> INR ${input.order.totalAmount}</p>
      <p><strong>Payment status:</strong> ${input.order.paymentStatus}</p>
      <p><strong>Order status:</strong> ${input.order.orderStatus}</p>
      <p><strong>Razorpay order id:</strong> ${input.order.razorpayOrderId ?? 'n/a'}</p>
      <p><strong>Razorpay payment id:</strong> ${input.order.razorpayPaymentId ?? 'n/a'}</p>
      ${settlementHtml}
      <p><a href="${adminOrdersUrl}">Open Admin Orders</a></p>
      <p><a href="${adminPaymentsUrl}">Open Admin Payments</a></p>
    `,
  });
};

interface IdempotencyPreparationResult {
  canProceed: boolean;
  record?: IIdempotencyRecord;
  replayResponse?: { status: number; body: Record<string, unknown> };
  errorResponse?: { status: number; body: Record<string, unknown> };
}

const prepareIdempotencyRecord = async (
  key: string,
  requestHash: string,
  customerId: mongoose.Types.ObjectId | null
): Promise<IdempotencyPreparationResult> => {
  const now = Date.now();
  const expiresAt = new Date(now + PAYMENT_VERIFY_IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);
  const lockExpiresAt = new Date(now + PAYMENT_VERIFY_IDEMPOTENCY_LOCK_SECONDS * 1000);
  const existing = await IdempotencyRecord.findOne({
    scope: PAYMENT_VERIFY_IDEMPOTENCY_SCOPE,
    key,
  });

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
            message: 'Payment verification is already being processed. Please retry shortly.',
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
      scope: PAYMENT_VERIFY_IDEMPOTENCY_SCOPE,
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
      const duplicate = await IdempotencyRecord.findOne({
        scope: PAYMENT_VERIFY_IDEMPOTENCY_SCOPE,
        key,
      });

      if (
        duplicate &&
        duplicate.status === 'completed' &&
        typeof duplicate.responseStatus === 'number' &&
        duplicate.responseBody
      ) {
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
            message: 'Payment verification is already being processed. Please retry shortly.',
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
  record.expiresAt = new Date(Date.now() + PAYMENT_VERIFY_IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);
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

const extractWebhookEventId = (req: Request, rawBody: Buffer): string => {
  const headerEventId = req.header('x-razorpay-event-id')?.trim();

  if (headerEventId) {
    return headerEventId;
  }

  return createHash('sha256').update(rawBody).digest('hex');
};

const isValidWebhookSignature = (
  rawBody: Buffer,
  signatureHeader: string,
  secret: string
): boolean => {
  const expectedSignature = createHmac('sha256', secret).update(rawBody).digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(signatureHeader);

  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
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

const ensureVerifiedCustomerForPayment = async (
  actor: AuthActor | undefined,
  res: Response
): Promise<boolean> => {
  if (!actor || actor.role !== 'customer') {
    return true;
  }

  const customer = await User.findById(actor.id).select('role isEmailVerified');

  if (!customer || customer.role !== 'customer') {
    res.status(403).json({ success: false, message: 'Forbidden: customer account is not valid' });
    return false;
  }

  if (!customer.isEmailVerified) {
    res.status(403).json({
      success: false,
      message: 'Please verify your email before starting payment.',
      code: 'EMAIL_NOT_VERIFIED',
    });
    return false;
  }

  return true;
};

export const createPaymentOrder = async (
  req: Request<unknown, unknown, CreatePaymentOrderBody>,
  res: Response
): Promise<void> => {
  try {
    const config = getRazorpayConfig();

    if (!config) {
      res.status(500).json({
        success: false,
        message: 'Payment gateway is not configured on server',
      });
      return;
    }

    const { orderId } = req.body;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      res.status(400).json({ success: false, message: 'Valid order id is required' });
      return;
    }

    const order = await Order.findById(orderId);

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const actor = (req as AuthContextRequest).auth;

    if (!canAccessOrder(order.customer, actor)) {
      res.status(403).json({ success: false, message: 'Forbidden: you cannot pay for this order' });
      return;
    }

    const verifiedForPayment = await ensureVerifiedCustomerForPayment(actor, res);

    if (!verifiedForPayment) {
      return;
    }

    if (order.paymentStatus === 'paid') {
      res.status(409).json({ success: false, message: 'Order is already paid' });
      return;
    }

    const amountInPaise = Math.round(order.totalAmount * 100);

    if (amountInPaise <= 0) {
      res.status(400).json({ success: false, message: 'Order amount is invalid for payment' });
      return;
    }

    if (!order.razorpayOrderId) {
      const razorpay = createRazorpayClient(config.keyId, config.keySecret);

      const razorpayOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: order.currency,
        receipt: `gaumaya_${order._id.toString()}`,
        notes: {
          internalOrderId: order._id.toString(),
        },
      });

      order.razorpayOrderId = razorpayOrder.id;
      await order.save();
    }

    res.status(200).json({
      success: true,
      keyId: config.keyId,
      orderId: order._id,
      razorpayOrderId: order.razorpayOrderId,
      amount: amountInPaise,
      currency: order.currency,
      merchantName: 'Gaumaya Farm',
      description: `Payment for order ${order._id.toString()}`,
      customer: {
        name: order.shippingInfo.fullName,
        email: order.shippingInfo.email,
        contact: order.shippingInfo.phone,
      },
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ success: false, message: 'Failed to initialize payment' });
  }
};

export const verifyPayment = async (
  req: Request<unknown, unknown, VerifyPaymentBody>,
  res: Response
): Promise<void> => {
  let idempotencyRecord: IIdempotencyRecord | undefined;

  try {
    const config = getRazorpayConfig();

    if (!config) {
      res.status(500).json({
        success: false,
        message: 'Payment gateway is not configured on server',
      });
      return;
    }

    const orderId = req.body.orderId?.trim() ?? '';
    const razorpayOrderId = req.body.razorpayOrderId?.trim() ?? '';
    const razorpayPaymentId = req.body.razorpayPaymentId?.trim() ?? '';
    const razorpaySignature = req.body.razorpaySignature?.trim() ?? '';

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      res.status(400).json({ success: false, message: 'Valid order id is required' });
      return;
    }

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      res.status(400).json({ success: false, message: 'Missing payment verification fields' });
      return;
    }

    const parsedIdempotencyKey = parseIdempotencyKey(req);

    if (parsedIdempotencyKey === '') {
      res.status(400).json({
        success: false,
        message:
          'Invalid idempotency key format. Use 8-200 chars with letters, numbers, dot, colon, underscore, or hyphen.',
      });
      return;
    }

    const requestHash = createRequestHash({
      orderId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    const actor = (req as AuthContextRequest).auth;
    const customerObjectId =
      actor?.role === 'customer' && mongoose.Types.ObjectId.isValid(actor.id)
        ? new mongoose.Types.ObjectId(actor.id)
        : null;

    const idempotencyResult = await prepareIdempotencyRecord(
      parsedIdempotencyKey ?? deriveVerifyIdempotencyKey(requestHash),
      requestHash,
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

    const order = await Order.findById(orderId);

    if (!order) {
      await rollbackIdempotencyRecord(idempotencyRecord);
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    if (!canAccessOrder(order.customer, actor)) {
      await rollbackIdempotencyRecord(idempotencyRecord);
      res.status(403).json({ success: false, message: 'Forbidden: you cannot verify this order payment' });
      return;
    }

    const verifiedForPayment = await ensureVerifiedCustomerForPayment(actor, res);

    if (!verifiedForPayment) {
      await rollbackIdempotencyRecord(idempotencyRecord);
      return;
    }

    if (!order.razorpayOrderId) {
      await rollbackIdempotencyRecord(idempotencyRecord);
      res.status(400).json({ success: false, message: 'No Razorpay order linked to this order' });
      return;
    }

    if (order.paymentStatus === 'paid') {
      const alreadyPaidResponse: Record<string, unknown> = {
        success: true,
        message: 'Payment already verified',
        orderId: order._id,
        paymentStatus: order.paymentStatus,
      };

      await completeIdempotencyRecord(idempotencyRecord, 200, alreadyPaidResponse);
      res.status(200).json(alreadyPaidResponse);
      return;
    }

    if (order.razorpayOrderId !== razorpayOrderId) {
      const mismatchResponse: Record<string, unknown> = { success: false, message: 'Razorpay order mismatch' };
      await completeIdempotencyRecord(idempotencyRecord, 400, mismatchResponse);
      res.status(400).json(mismatchResponse);
      return;
    }

    const expectedSignature = createHmac('sha256', config.keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature);
    const providedBuffer = Buffer.from(razorpaySignature);

    const isValidSignature =
      expectedBuffer.length === providedBuffer.length &&
      timingSafeEqual(expectedBuffer, providedBuffer);

    if (!isValidSignature) {
      order.paymentStatus = 'failed';
      await order.save();

      const invalidSignatureResponse: Record<string, unknown> = {
        success: false,
        message: 'Invalid payment signature',
      };
      await completeIdempotencyRecord(idempotencyRecord, 400, invalidSignatureResponse);
      res.status(400).json(invalidSignatureResponse);
      return;
    }

    order.paymentStatus = 'paid';
    if (order.orderStatus !== 'cancelled') {
      order.orderStatus = 'processing';
    }
    order.razorpayPaymentId = razorpayPaymentId;
    order.razorpaySignature = razorpaySignature;
    order.paidAt = new Date();
    ensureRefundPendingForCancelledPaidOrder(order);
    await order.save();

    const successResponse: Record<string, unknown> = {
      success: true,
      message: 'Payment verified successfully',
      orderId: order._id,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
    };

    void safeSendAdminPaymentEventEmail({
      order,
      title: 'Payment verified',
      summary: 'A payment was verified from checkout verification flow.',
    });

    await completeIdempotencyRecord(idempotencyRecord, 200, successResponse);
    res.status(200).json(successResponse);
  } catch (error) {
    await rollbackIdempotencyRecord(idempotencyRecord);
    console.error('Error verifying payment:', error);
    res.status(500).json({ success: false, message: 'Failed to verify payment' });
  }
};

export const getPaymentWebhookEvents = async (
  req: Request<unknown, unknown, unknown, WebhookEventsQuery>,
  res: Response
): Promise<void> => {
  try {
    const { status, eventType, search, limit } = req.query;

    const filters: Record<string, unknown> = {};

    if (status && ['processing', 'processed', 'failed'].includes(status)) {
      filters.status = status;
    }

    if (eventType && eventType.trim()) {
      filters.eventType = eventType.trim();
    }

    if (search && search.trim()) {
      const safeSearch = search.trim();
      filters.$or = [
        { eventId: { $regex: safeSearch, $options: 'i' } },
        { razorpayOrderId: { $regex: safeSearch, $options: 'i' } },
        { razorpayPaymentId: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    const parsedLimit = Number(limit);
    const safeLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 200;

    const events = await PaymentWebhookEvent.find(filters).sort({ receivedAt: -1 }).limit(safeLimit).lean();

    const orderIds = Array.from(
      new Set(
        events
          .map((event) => event.razorpayOrderId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    );

    const relatedOrders = await Order.find({ razorpayOrderId: { $in: orderIds } })
      .select('_id razorpayOrderId paymentStatus orderStatus totalAmount createdAt')
      .lean();

    const orderMap = new Map(relatedOrders.map((order) => [order.razorpayOrderId, order]));

    const withOrder = events.map((event) => ({
      ...event,
      order: event.razorpayOrderId ? orderMap.get(event.razorpayOrderId) ?? null : null,
    }));

    const [totalCount, processedCount, processingCount, failedCount] = await Promise.all([
      PaymentWebhookEvent.countDocuments(),
      PaymentWebhookEvent.countDocuments({ status: 'processed' }),
      PaymentWebhookEvent.countDocuments({ status: 'processing' }),
      PaymentWebhookEvent.countDocuments({ status: 'failed' }),
    ]);

    res.status(200).json({
      success: true,
      count: withOrder.length,
      summary: {
        total: totalCount,
        processed: processedCount,
        processing: processingCount,
        failed: failedCount,
      },
      events: withOrder,
    });
  } catch (error) {
    console.error('Error fetching webhook events:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch webhook events' });
  }
};

export const handleRazorpayWebhook = async (req: Request, res: Response): Promise<void> => {
  const webhookSecret = getWebhookSecret();

  if (!webhookSecret) {
    res.status(500).json({
      success: false,
      message: 'Razorpay webhook secret is not configured on server',
    });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const signatureHeader = req.header('x-razorpay-signature')?.trim();

  if (!rawBody || !signatureHeader) {
    res.status(400).json({ success: false, message: 'Missing webhook signature or payload' });
    return;
  }

  if (!isValidWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
    res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    return;
  }

  const webhookPayload = req.body as RazorpayWebhookPayload;
  const eventType = webhookPayload.event ?? 'unknown';
  const paymentEntity = webhookPayload.payload?.payment?.entity;
  const orderEntity = webhookPayload.payload?.order?.entity;
  const refundEntity = webhookPayload.payload?.refund?.entity;
  const razorpayOrderId = paymentEntity?.order_id ?? orderEntity?.id ?? refundEntity?.order_id ?? null;
  const razorpayPaymentId = paymentEntity?.id ?? refundEntity?.payment_id ?? null;
  const gatewaySettlementStatus = resolveGatewaySettlementStatusFromWebhook(
    eventType,
    refundEntity?.status
  );
  const eventId = extractWebhookEventId(req, rawBody);

  let eventRecord = await PaymentWebhookEvent.findOne({ eventId });

  if (eventRecord?.status === 'processed') {
    res.status(200).json({ success: true, message: 'Webhook already processed' });
    return;
  }

  if (!eventRecord) {
    eventRecord = await PaymentWebhookEvent.create({
      eventId,
      eventType,
      status: 'processing',
      attempts: 1,
      razorpayOrderId,
      razorpayPaymentId,
      receivedAt: new Date(),
    });
  } else {
    eventRecord.status = 'processing';
    eventRecord.eventType = eventType;
    eventRecord.attempts += 1;
    eventRecord.razorpayOrderId = razorpayOrderId;
    eventRecord.razorpayPaymentId = razorpayPaymentId;
    eventRecord.lastError = null;
    await eventRecord.save();
  }

  try {
    let order: IOrder | null = null;

    if (razorpayOrderId) {
      order = await Order.findOne({ razorpayOrderId });
    }

    if (!order && razorpayPaymentId) {
      order = await Order.findOne({ razorpayPaymentId });
    }

    if (order) {
      const previousPaymentStatus = order.paymentStatus;
      const previousSettlementStatus = order.refundInfo?.gatewaySettlementStatus ?? 'unknown';
      const paymentStatus = paymentEntity?.status;
      const isCapturedEvent = eventType === 'payment.captured' || paymentStatus === 'captured';
      const isFailedEvent = eventType === 'payment.failed' || paymentStatus === 'failed';

      if (isCapturedEvent) {
        order.paymentStatus = 'paid';

        if (order.orderStatus === 'placed') {
          order.orderStatus = 'processing';
        }

        if (razorpayPaymentId) {
          order.razorpayPaymentId = razorpayPaymentId;
        }

        order.paidAt = order.paidAt || new Date();
        ensureRefundPendingForCancelledPaidOrder(order);
      } else if (isFailedEvent && order.paymentStatus !== 'paid') {
        order.paymentStatus = 'failed';
      }

      if (gatewaySettlementStatus) {
        applyGatewaySettlementUpdate(order, gatewaySettlementStatus, refundEntity?.id ?? null);
      }

      await order.save();

      const didTransitionToPaid = previousPaymentStatus !== 'paid' && order.paymentStatus === 'paid';
      const didTransitionToFailed = previousPaymentStatus !== 'failed' && order.paymentStatus === 'failed';
      const didSettlementStatusChange =
        previousSettlementStatus !== (order.refundInfo?.gatewaySettlementStatus ?? 'unknown');

      if (didTransitionToPaid) {
        void safeSendAdminPaymentEventEmail({
          order,
          title: 'Payment captured (webhook)',
          summary: `Gateway webhook (${eventType}) marked payment as paid.`,
        });
      }

      if (didTransitionToFailed) {
        void safeSendAdminPaymentEventEmail({
          order,
          title: 'Payment failed (webhook)',
          summary: `Gateway webhook (${eventType}) marked payment as failed.`,
        });
      }

      if (didSettlementStatusChange) {
        void safeSendAdminPaymentEventEmail({
          order,
          title: 'Refund settlement updated',
          summary: `Gateway webhook (${eventType}) updated refund settlement status.`,
          includeSettlementDetails: true,
        });
      }
    }

    eventRecord.status = 'processed';
    eventRecord.processedAt = new Date();
    await eventRecord.save();

    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    eventRecord.status = 'failed';
    eventRecord.lastError = error instanceof Error ? error.message : 'Unknown webhook processing error';
    await eventRecord.save();

    console.error('Error processing Razorpay webhook:', error);
    res.status(500).json({ success: false, message: 'Failed to process webhook event' });
  }
};
