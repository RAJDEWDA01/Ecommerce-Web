"use client";

import dynamic from 'next/dynamic';
import type { ProductCardItem } from '@/components/ProductCardActions';

const ProductCardActions = dynamic(() => import('@/components/ProductCardActions'), {
  ssr: false,
  loading: () => (
    <div className="h-10 w-40 rounded-xl border border-stone-200 bg-stone-100/70" aria-hidden />
  ),
});

export default function DeferredProductCardActions({ product }: { product: ProductCardItem }) {
  return <ProductCardActions product={product} />;
}
