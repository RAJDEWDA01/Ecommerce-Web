import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IProductVariant {
  label: string;
  size: string;
  price: number;
  stockQuantity: number;
  sku: string;
  imageUrl?: string | null;
  isDefault: boolean;
}

export interface IProductReview {
  customer?: Types.ObjectId | null;
  customerName: string;
  rating: number;
  title?: string | null;
  comment: string;
  isVerifiedPurchase: boolean;
  createdAt: Date;
}

export interface IProduct extends Document {
  name: string;
  description: string;
  price: number;
  size: string;
  imageUrl: string;
  imageGallery: string[];
  variants: IProductVariant[];
  stockQuantity: number;
  sku: string;
  isFeatured: boolean;
  reviews: IProductReview[];
  ratingAverage: number;
  ratingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductVariantSchema = new Schema<IProductVariant>(
  {
    label: { type: String, required: true, trim: true },
    size: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    stockQuantity: { type: Number, required: true, min: 0, default: 0 },
    sku: { type: String, required: true, trim: true },
    imageUrl: { type: String, default: null, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: false }
);

const ProductReviewSchema = new Schema<IProductReview>(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    customerName: { type: String, required: true, trim: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, default: null, trim: true },
    comment: { type: String, required: true, trim: true },
    isVerifiedPurchase: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const ProductSchema: Schema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    size: { type: String, required: true, trim: true },
    imageUrl: { type: String, required: true, trim: true },
    imageGallery: { type: [String], default: [] },
    variants: { type: [ProductVariantSchema], default: [] },
    stockQuantity: { type: Number, required: true, min: 0, default: 0 },
    sku: { type: String, required: true, unique: true, trim: true },
    isFeatured: { type: Boolean, default: false },
    reviews: { type: [ProductReviewSchema], default: [] },
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
  }
);

ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ isFeatured: 1, createdAt: -1 });
ProductSchema.index({ stockQuantity: 1, createdAt: -1 });
ProductSchema.index({ price: 1, createdAt: -1 });
ProductSchema.index({ name: 1 });
ProductSchema.index({ ratingAverage: -1, createdAt: -1 });
ProductSchema.index({ 'variants.sku': 1 });

export default mongoose.model<IProduct>('Product', ProductSchema);
