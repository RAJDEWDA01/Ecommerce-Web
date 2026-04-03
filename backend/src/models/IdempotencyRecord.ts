import mongoose, { Schema, Document, Types } from 'mongoose';

export type IdempotencyScope = 'create_order' | 'payment_verify';

export interface IIdempotencyRecord extends Document {
  scope: IdempotencyScope;
  key: string;
  requestHash: string;
  status: 'processing' | 'completed';
  responseStatus?: number | null;
  responseBody?: Record<string, unknown> | null;
  customer?: Types.ObjectId | null;
  lockExpiresAt?: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const IdempotencyRecordSchema = new Schema<IIdempotencyRecord>(
  {
    scope: { type: String, enum: ['create_order', 'payment_verify'], required: true },
    key: { type: String, required: true, trim: true },
    requestHash: { type: String, required: true },
    status: { type: String, enum: ['processing', 'completed'], required: true },
    responseStatus: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null },
    customer: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lockExpiresAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
  }
);

IdempotencyRecordSchema.index({ scope: 1, key: 1 }, { unique: true });
IdempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IIdempotencyRecord>('IdempotencyRecord', IdempotencyRecordSchema);
