import mongoose, { Schema, type Document } from 'mongoose';

export type AdminNotificationEventType = 'order' | 'payment' | 'support' | 'feedback';
export type AdminNotificationDeliveryStatus = 'sent' | 'failed' | 'retrying' | 'skipped';
export type AdminNotificationSkipReason = 'event_disabled' | 'no_recipients' | null;

export interface IAdminNotificationDelivery extends Document {
  eventType: AdminNotificationEventType;
  subject: string;
  text: string;
  html: string;
  recipients: string[];
  status: AdminNotificationDeliveryStatus;
  skipReason: AdminNotificationSkipReason;
  failureReason: string | null;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AdminNotificationDeliverySchema = new Schema<IAdminNotificationDelivery>(
  {
    eventType: {
      type: String,
      enum: ['order', 'payment', 'support', 'feedback'],
      required: true,
    },
    subject: { type: String, required: true, trim: true },
    text: { type: String, required: true },
    html: { type: String, required: true },
    recipients: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['sent', 'failed', 'retrying', 'skipped'],
      required: true,
    },
    skipReason: {
      type: String,
      enum: ['event_disabled', 'no_recipients', null],
      default: null,
    },
    failureReason: { type: String, default: null, trim: true },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    maxAttempts: { type: Number, required: true, default: 5, min: 1 },
    nextRetryAt: { type: Date, default: null },
    lastAttemptAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

AdminNotificationDeliverySchema.index({ status: 1, nextRetryAt: 1, createdAt: -1 });
AdminNotificationDeliverySchema.index({ eventType: 1, createdAt: -1 });
AdminNotificationDeliverySchema.index({ createdAt: -1 });

export default mongoose.model<IAdminNotificationDelivery>(
  'AdminNotificationDelivery',
  AdminNotificationDeliverySchema
);
