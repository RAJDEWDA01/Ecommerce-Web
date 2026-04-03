import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface ISupportTicketNote {
  note: string;
  authorId?: Types.ObjectId | null;
  authorEmail?: string | null;
  createdAt: Date;
}

export interface ISupportTicket extends Document {
  customer?: Types.ObjectId | null;
  name: string;
  email: string;
  phone?: string | null;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  notes: ISupportTicketNote[];
  createdAt: Date;
  updatedAt: Date;
}

const SupportTicketNoteSchema = new Schema<ISupportTicketNote>(
  {
    note: { type: String, required: true, trim: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    authorEmail: { type: String, default: null, trim: true, lowercase: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const SupportTicketSchema = new Schema<ISupportTicket>(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: null, trim: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
    },
    notes: {
      type: [SupportTicketNoteSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

SupportTicketSchema.index({ status: 1, createdAt: -1 });
SupportTicketSchema.index({ email: 1, createdAt: -1 });

export default mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);
