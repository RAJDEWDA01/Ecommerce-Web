import mongoose, { Schema, type Document } from 'mongoose';

export type AuditOutcome = 'success' | 'failure';
export type AuditActorRole = 'admin' | 'customer' | 'system' | 'anonymous';

export interface IAuditLog extends Document {
  action: string;
  outcome: AuditOutcome;
  actorId?: string | null;
  actorRole: AuditActorRole;
  actorEmail?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
  method?: string | null;
  path?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  statusCode?: number | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true, trim: true },
    outcome: { type: String, enum: ['success', 'failure'], required: true },
    actorId: { type: String, default: null },
    actorRole: {
      type: String,
      enum: ['admin', 'customer', 'system', 'anonymous'],
      default: 'anonymous',
    },
    actorEmail: { type: String, default: null },
    resourceType: { type: String, default: null },
    resourceId: { type: String, default: null },
    requestId: { type: String, default: null },
    method: { type: String, default: null },
    path: { type: String, default: null },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    statusCode: { type: Number, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
  }
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ actorRole: 1, createdAt: -1 });
AuditLogSchema.index({ requestId: 1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
