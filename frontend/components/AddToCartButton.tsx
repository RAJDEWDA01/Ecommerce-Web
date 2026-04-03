"use client";

import { useCartStore } from '../store/cartStore';

interface ProductCardItem {
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

export default function AddToCartButton({ product }: { product: ProductCardItem }) {
  const addToCart = useCartStore((state) => state.addToCart);

  return (
    <button
      onClick={() =>
        addToCart({
          ...product,
          productId: product.productId ?? product._id,
          variantSku: product.variantSku ?? null,
          variantLabel: product.variantLabel ?? null,
        })
      }
      className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-xl font-semibold"
    >
      Add to Cart
    </button>
  );
}
