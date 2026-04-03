import mongoose, { Schema, Document, Types } from 'mongoose';

export type AuthTokenType = 'email_verification' | 'password_reset';

export interface IAuthToken extends Document {
  user: Types.ObjectId;
  tokenHash: string;
  type: AuthTokenType;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AuthTokenSchema = new Schema<IAuthToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    type: { type: String, enum: ['email_verification', 'password_reset'], required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

AuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AuthTokenSchema.index({ user: 1, type: 1, createdAt: -1 });

export default mongoose.model<IAuthToken>('AuthToken', AuthTokenSchema);
