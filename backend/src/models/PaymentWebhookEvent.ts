import mongoose, { Schema, Document } from 'mongoose';

export interface IPaymentWebhookEvent extends Document {
  eventId: string;
  eventType: string;
  status: 'processing' | 'processed' | 'failed';
  attempts: number;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  lastError?: string | null;
  processedAt?: Date | null;
  receivedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentWebhookEventSchema = new Schema<IPaymentWebhookEvent>(
  {
    eventId: { type: String, required: true, unique: true, trim: true },
    eventType: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['processing', 'processed', 'failed'],
      default: 'processing',
    },
    attempts: { type: Number, default: 1, min: 1 },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    lastError: { type: String, default: null },
    processedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: () => new Date() },
  },
  {
    timestamps: true,
  }
);

PaymentWebhookEventSchema.index({ createdAt: -1 });

export default mongoose.model<IPaymentWebhookEvent>(
  'PaymentWebhookEvent',
  PaymentWebhookEventSchema
);
