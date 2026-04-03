import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type FeedbackStatus = 'new' | 'reviewed' | 'archived';

export interface IFeedback extends Document {
  customer?: Types.ObjectId | null;
  name: string;
  email: string;
  phone?: string | null;
  rating: number;
  message: string;
  status: FeedbackStatus;
  adminNote?: string | null;
  reviewedAt?: Date | null;
  reviewedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const FeedbackSchema = new Schema<IFeedback>(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: null, trim: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    message: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['new', 'reviewed', 'archived'],
      default: 'new',
    },
    adminNote: { type: String, default: null, trim: true },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
  }
);

FeedbackSchema.index({ status: 1, createdAt: -1 });
FeedbackSchema.index({ email: 1, createdAt: -1 });
FeedbackSchema.index({ rating: 1, createdAt: -1 });

export default mongoose.model<IFeedback>('Feedback', FeedbackSchema);

