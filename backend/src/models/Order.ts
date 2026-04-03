import mongoose, { Schema, Document, Types } from 'mongoose';

interface IShippingInfo {
  fullName: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  phone: string;
}

interface ISourceAddressSnapshot {
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface IOrderItem {
  product: Types.ObjectId;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export type OrderCancellationStatus = 'none' | 'requested' | 'approved' | 'rejected';

interface IOrderCancellationRequest {
  status: OrderCancellationStatus;
  reason?: string | null;
  requestedAt?: Date | null;
  requestedBy?: Types.ObjectId | null;
  reviewedAt?: Date | null;
  reviewedBy?: Types.ObjectId | null;
  reviewNote?: string | null;
}

export type OrderRefundStatus = 'not_required' | 'pending' | 'processed' | 'failed';
export type OrderRefundSettlementStatus = 'unknown' | 'pending' | 'settled' | 'failed';

interface IOrderRefundInfo {
  status: OrderRefundStatus;
  amount: number;
  currency: 'INR';
  initiatedAt?: Date | null;
  processedAt?: Date | null;
  updatedBy?: Types.ObjectId | null;
  reference?: string | null;
  note?: string | null;
  gatewayRefundId?: string | null;
  gatewaySettlementStatus: OrderRefundSettlementStatus;
  gatewaySettlementAt?: Date | null;
}

interface IOrderFulfillmentInfo {
  courierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  packedAt?: Date | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
}

export interface IOrder extends Document {
  customer?: Types.ObjectId | null;
  shippingInfo: IShippingInfo;
  sourceAddressId?: Types.ObjectId | null;
  sourceAddressSnapshot?: ISourceAddressSnapshot | null;
  cancellationRequest: IOrderCancellationRequest;
  refundInfo: IOrderRefundInfo;
  fulfillmentInfo: IOrderFulfillmentInfo;
  items: IOrderItem[];
  subtotal: number;
  discountAmount: number;
  couponCode?: string | null;
  shippingFee: number;
  totalAmount: number;
  currency: 'INR';
  paymentStatus: 'pending' | 'paid' | 'failed';
  orderStatus: 'placed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ShippingInfoSchema = new Schema<IShippingInfo>(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const SourceAddressSnapshotSchema = new Schema<ISourceAddressSnapshot>(
  {
    label: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: null, trim: true },
    landmark: { type: String, default: null, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const OrderItemSchema = new Schema<IOrderItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const OrderCancellationRequestSchema = new Schema<IOrderCancellationRequest>(
  {
    status: {
      type: String,
      enum: ['none', 'requested', 'approved', 'rejected'],
      default: 'none',
    },
    reason: { type: String, default: null, trim: true },
    requestedAt: { type: Date, default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewNote: { type: String, default: null, trim: true },
  },
  { _id: false }
);

const OrderRefundInfoSchema = new Schema<IOrderRefundInfo>(
  {
    status: {
      type: String,
      enum: ['not_required', 'pending', 'processed', 'failed'],
      default: 'not_required',
    },
    amount: { type: Number, default: 0, min: 0 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    initiatedAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reference: { type: String, default: null, trim: true },
    note: { type: String, default: null, trim: true },
    gatewayRefundId: { type: String, default: null, trim: true },
    gatewaySettlementStatus: {
      type: String,
      enum: ['unknown', 'pending', 'settled', 'failed'],
      default: 'unknown',
    },
    gatewaySettlementAt: { type: Date, default: null },
  },
  { _id: false }
);

const OrderFulfillmentInfoSchema = new Schema<IOrderFulfillmentInfo>(
  {
    courierName: { type: String, default: null, trim: true },
    trackingNumber: { type: String, default: null, trim: true },
    trackingUrl: { type: String, default: null, trim: true },
    packedAt: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { _id: false }
);

const OrderSchema = new Schema<IOrder>(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    shippingInfo: { type: ShippingInfoSchema, required: true },
    sourceAddressId: { type: Schema.Types.ObjectId, ref: 'Address', default: null },
    sourceAddressSnapshot: { type: SourceAddressSnapshotSchema, default: null },
    cancellationRequest: { type: OrderCancellationRequestSchema, default: () => ({ status: 'none' }) },
    refundInfo: {
      type: OrderRefundInfoSchema,
      default: () => ({
        status: 'not_required',
        amount: 0,
        currency: 'INR',
        gatewaySettlementStatus: 'unknown',
      }),
    },
    fulfillmentInfo: {
      type: OrderFulfillmentInfoSchema,
      default: () => ({
        courierName: null,
        trackingNumber: null,
        trackingUrl: null,
        packedAt: null,
        shippedAt: null,
        deliveredAt: null,
      }),
    },
    items: { type: [OrderItemSchema], required: true },
    subtotal: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    couponCode: { type: String, default: null },
    shippingFee: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },
    orderStatus: {
      type: String,
      enum: ['placed', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'placed',
    },
    razorpayOrderId: { type: String, trim: true },
    razorpayPaymentId: { type: String, default: null },
    razorpaySignature: { type: String, default: null },
    paidAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ customer: 1, createdAt: -1 });
OrderSchema.index({ orderStatus: 1, createdAt: -1 });
OrderSchema.index({ paymentStatus: 1, createdAt: -1 });
OrderSchema.index({ 'shippingInfo.email': 1, createdAt: -1 });
OrderSchema.index({ customer: 1, sourceAddressId: 1, createdAt: -1 });
OrderSchema.index({ 'cancellationRequest.status': 1, createdAt: -1 });
OrderSchema.index({ 'refundInfo.status': 1, createdAt: -1 });
OrderSchema.index(
  { razorpayOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      razorpayOrderId: { $type: 'string' },
    },
  }
);
OrderSchema.index({ couponCode: 1, createdAt: -1 });

export default mongoose.model<IOrder>('Order', OrderSchema);
