"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { customerApiFetch, getCustomerToken } from '@/lib/customerAuth';

interface AddToWishlistButtonProps {
  productId: string;
}

interface WishlistMutationResponse {
  success: boolean;
  message?: string;
}

export default function AddToWishlistButton({ productId }: AddToWishlistButtonProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!getCustomerToken()) {
      router.push('/account/login');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await customerApiFetch('/api/wishlist/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId }),
      });

      const data = (await response.json()) as WishlistMutationResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Unable to save to wishlist');
      }

      setIsSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save to wishlist');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => {
          void handleAdd();
        }}
        disabled={isSaving || isSaved}
        className="rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 disabled:bg-emerald-100 disabled:border-emerald-200 px-3 py-2 text-xs font-semibold text-amber-800 disabled:text-emerald-700 transition-colors"
      >
        {isSaving ? 'Saving...' : isSaved ? 'Saved' : 'Wishlist'}
      </button>
      {error && <p className="text-[11px] text-red-600 max-w-[120px] text-right">{error}</p>}
    </div>
  );
}
