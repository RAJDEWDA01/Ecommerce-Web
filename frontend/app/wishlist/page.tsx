"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useCartStore } from '@/store/cartStore';
import {
  customerApiFetch,
  getCustomerToken,
  logoutCustomerSession,
  refreshCustomerSession,
} from '@/lib/customerAuth';
import { resolveImageUrl } from '@/lib/api';

interface WishlistProduct {
  _id: string;
  name: string;
  description: string;
  price: number;
  size: string;
  imageUrl: string;
  stockQuantity: number;
  sku: string;
  isFeatured: boolean;
}

interface WishlistItem {
  productId: string;
  addedAt: string;
  product: WishlistProduct;
}

interface WishlistResponse {
  success: boolean;
  message?: string;
  items?: WishlistItem[];
  count?: number;
}

export default function WishlistPage() {
  const router = useRouter();
  const addToCart = useCartStore((state) => state.addToCart);

  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      const existingToken = getCustomerToken();

      if (existingToken) {
        setToken(existingToken);
        return;
      }

      const refreshedToken = await refreshCustomerSession();

      if (refreshedToken) {
        setToken(refreshedToken);
        return;
      }

      router.replace('/account/login');
    };

    void bootstrap();
  }, [router]);

  useEffect(() => {
    const fetchWishlist = async () => {
      if (!token) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await customerApiFetch('/api/wishlist', { cache: 'no-store' });

        if (response.status === 401 || response.status === 403) {
          await logoutCustomerSession();
          router.replace('/account/login');
          return;
        }

        const data = (await response.json()) as WishlistResponse;

        if (!response.ok || !data.success || !data.items) {
          throw new Error(data.message || 'Failed to load wishlist');
        }

        setItems(data.items);
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load wishlist');
      } finally {
        setLoading(false);
      }
    };

    void fetchWishlist();
  }, [token, router]);

  const handleRemoveItem = async (productId: string) => {
    setError(null);

    try {
      const response = await customerApiFetch(`/api/wishlist/items/${productId}`, {
        method: 'DELETE',
      });

      const data = (await response.json()) as WishlistResponse;

      if (!response.ok || !data.success || !data.items) {
        throw new Error(data.message || 'Unable to remove item');
      }

      setItems(data.items);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unable to remove item');
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6 sm:py-10 lg:p-10 flex items-center justify-center">
        <p className="text-lg text-stone-700">Loading wishlist...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 shadow-sm">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-stone-900">My Wishlist</h1>
            <p className="text-stone-600 mt-1">Save products you want to buy later.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/" className="bg-stone-200 hover:bg-stone-300 text-stone-800 px-4 py-2 rounded-lg text-sm font-semibold">
              Shop
            </Link>
            <Link href="/cart" className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              Cart
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {items.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-stone-600">
            Wishlist is empty right now.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {items.map((item) => (
              <article key={item.productId} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex gap-4">
                  <Image
                    src={resolveImageUrl(item.product.imageUrl)}
                    alt={item.product.name}
                    width={80}
                    height={80}
                    className="h-20 w-20 object-contain rounded-lg border border-stone-100 bg-stone-50 p-2"
                  />
                  <div className="min-w-0">
                    <h2 className="font-semibold text-stone-900 break-all">{item.product.name}</h2>
                    <p className="text-sm text-stone-500 mt-1 line-clamp-2">{item.product.description}</p>
                    <p className="text-amber-700 font-bold mt-2">₹{item.product.price}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      addToCart({
                        _id: item.product._id,
                        productId: item.product._id,
                        name: item.product.name,
                        price: item.product.price,
                        imageUrl: item.product.imageUrl,
                        size: item.product.size,
                        sku: item.product.sku,
                        variantSku: null,
                        variantLabel: null,
                      })
                    }
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-sm font-semibold"
                  >
                    Add to Cart
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleRemoveItem(item.productId);
                    }}
                    className="bg-stone-200 hover:bg-stone-300 text-stone-800 px-3 py-2 rounded-lg text-sm font-semibold"
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
