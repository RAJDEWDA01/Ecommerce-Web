"use client";

import AddToCartButton from '@/components/AddToCartButton';
import AddToWishlistButton from '@/components/AddToWishlistButton';

export interface ProductCardItem {
  _id: string;
  productId?: string;
  name: string;
  price: number;
  imageUrl: string;
  size: string;
  sku?: string;
  variantSku?: string | null;
  variantLabel?: string | null;
}

export default function ProductCardActions({ product }: { product: ProductCardItem }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <AddToWishlistButton productId={product._id} />
      <AddToCartButton product={product} />
    </div>
  );
}
