"use client";

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { customerApiFetch, getCustomerToken } from '@/lib/customerAuth';
import { resolveImageUrl } from '@/lib/api';
import { useCartStore } from '@/store/cartStore';
import AddToWishlistButton from '@/components/AddToWishlistButton';

interface ProductVariant {
  label: string;
  size: string;
  price: number;
  stockQuantity: number;
  sku: string;
  imageUrl?: string | null;
  isDefault: boolean;
}

interface ProductReview {
  _id?: string;
  customerName: string;
  rating: number;
  title?: string | null;
  comment: string;
  isVerifiedPurchase: boolean;
  createdAt: string;
}

interface Product {
  _id: string;
  name: string;
  description: string;
  price: number;
  size: string;
  imageUrl: string;
  imageGallery?: string[];
  variants?: ProductVariant[];
  stockQuantity: number;
  sku: string;
  isFeatured: boolean;
  ratingAverage?: number;
  ratingCount?: number;
  reviews?: ProductReview[];
}

interface Props {
  product: Product;
  relatedProducts: Product[];
}

interface CreateReviewResponse {
  success: boolean;
  message?: string;
  review?: ProductReview;
  ratingAverage?: number;
  ratingCount?: number;
}

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);

const toStars = (rating: number): string => {
  const normalized = Math.max(1, Math.min(5, Math.round(rating)));
  return '★'.repeat(normalized) + '☆'.repeat(5 - normalized);
};

const normalizeSizeLabel = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');

  if (normalized.endsWith('ml')) {
    const amount = Number(normalized.replace('ml', ''));
    if (Number.isFinite(amount)) {
      return `${amount} ml`;
    }
  }

  if (normalized.endsWith('kg')) {
    const amount = Number(normalized.replace('kg', ''));
    if (Number.isFinite(amount)) {
      return `${amount} kg`;
    }
  }

  return value;
};

const sizeRank = (value: string): number => {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');

  if (normalized.endsWith('ml')) {
    const amount = Number(normalized.replace('ml', ''));
    return Number.isFinite(amount) ? amount : Number.MAX_SAFE_INTEGER;
  }

  if (normalized.endsWith('kg')) {
    const amount = Number(normalized.replace('kg', ''));
    return Number.isFinite(amount) ? amount * 1000 : Number.MAX_SAFE_INTEGER;
  }

  return Number.MAX_SAFE_INTEGER;
};

export default function ProductDetailsClient({ product, relatedProducts }: Props) {
  const addToCart = useCartStore((state) => state.addToCart);

  const variants = useMemo(() => {
    const existingVariants = Array.isArray(product.variants) ? product.variants : [];
    return [...existingVariants].sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
  }, [product.variants]);

  const defaultVariant = useMemo(() => {
    if (variants.length === 0) {
      return null;
    }

    return variants.find((variant) => variant.isDefault) ?? variants[0] ?? null;
  }, [variants]);

  const [selectedVariantSku, setSelectedVariantSku] = useState<string | null>(
    defaultVariant?.sku ?? null
  );
  const selectedVariant =
    variants.find((variant) => variant.sku === selectedVariantSku) ?? defaultVariant;

  const galleryImages = useMemo(() => {
    const merged = [
      product.imageUrl,
      ...(Array.isArray(product.imageGallery) ? product.imageGallery : []),
      ...variants.map((variant) => variant.imageUrl || '').filter(Boolean),
    ];
    return [...new Set(merged.filter(Boolean))].slice(0, 4);
  }, [product.imageGallery, product.imageUrl, variants]);

  const [activeImage, setActiveImage] = useState<string>(
    selectedVariant?.imageUrl || galleryImages[0] || product.imageUrl
  );

  const [reviews, setReviews] = useState<ProductReview[]>(
    (product.reviews ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );
  const [ratingAverage, setRatingAverage] = useState<number>(
    typeof product.ratingAverage === 'number' ? product.ratingAverage : 0
  );
  const [ratingCount, setRatingCount] = useState<number>(
    typeof product.ratingCount === 'number' ? product.ratingCount : reviews.length
  );

  const [reviewName, setReviewName] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [hasCustomerToken, setHasCustomerToken] = useState(false);

  const displayPrice = selectedVariant ? selectedVariant.price : product.price;
  const displaySize = selectedVariant ? selectedVariant.size : product.size;
  const displaySku = selectedVariant ? selectedVariant.sku : product.sku;
  const displayStock = selectedVariant ? selectedVariant.stockQuantity : product.stockQuantity;
  const displayVariantLabel = selectedVariant ? selectedVariant.label : displaySize;

  const handleVariantSelect = (sku: string) => {
    setSelectedVariantSku(sku);
    const chosen = variants.find((variant) => variant.sku === sku);
    if (chosen?.imageUrl) {
      setActiveImage(chosen.imageUrl);
    }
  };

  const handleAddToCart = () => {
    const lineId = selectedVariant ? `${product._id}::${selectedVariant.sku}` : product._id;
    addToCart({
      _id: lineId,
      productId: product._id,
      name: product.name,
      price: displayPrice,
      imageUrl: activeImage || product.imageUrl,
      size: displaySize,
      sku: displaySku,
      variantSku: selectedVariant?.sku ?? null,
      variantLabel: displayVariantLabel,
    });
  };

  const handleSubmitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReviewError(null);
    setReviewSuccess(null);

    if (!reviewComment.trim()) {
      setReviewError('Please write your review comment.');
      return;
    }

    setSubmittingReview(true);

    try {
      const response = await customerApiFetch(`/api/products/${product._id}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...(hasCustomerToken ? {} : { name: reviewName }),
          rating: reviewRating,
          title: reviewTitle,
          comment: reviewComment,
        }),
      });

      const data = (await response.json()) as CreateReviewResponse;

      if (!response.ok || !data.success || !data.review) {
        throw new Error(data.message || 'Failed to submit review');
      }

      setReviews((prev) => [data.review as ProductReview, ...prev]);
      if (typeof data.ratingAverage === 'number') {
        setRatingAverage(data.ratingAverage);
      }
      if (typeof data.ratingCount === 'number') {
        setRatingCount(data.ratingCount);
      }

      setReviewTitle('');
      setReviewComment('');
      setReviewSuccess(data.message || 'Review submitted successfully');
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Failed to submit review');
    } finally {
      setSubmittingReview(false);
    }
  };

  useEffect(() => {
    setHasCustomerToken(Boolean(getCustomerToken()));
  }, []);

  return (
    <main className="min-h-screen px-4 pt-6 pb-28 sm:px-6 sm:pt-8 sm:pb-8 lg:p-10">
      <div className="max-w-6xl mx-auto">
        <nav className="mb-5 text-sm text-stone-600">
          <Link href="/" className="hover:text-amber-700">
            Home
          </Link>
          <span className="mx-2">/</span>
          <span className="text-stone-800 font-semibold">{product.name}</span>
        </nav>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
          <article className="rounded-2xl border border-stone-200 bg-white shadow-sm p-4">
            <div className="relative h-[320px] sm:h-[420px] bg-stone-50 flex items-center justify-center rounded-xl overflow-hidden">
              <Image
                src={resolveImageUrl(activeImage || product.imageUrl)}
                alt={product.name}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-contain p-6 sm:p-8"
              />
              {product.isFeatured && (
                <span className="absolute top-4 left-4 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Featured
                </span>
              )}
            </div>

            {galleryImages.length > 1 && (
              <div className="mt-4 grid grid-cols-4 sm:grid-cols-5 gap-2">
                {galleryImages.map((imageUrl) => (
                  <button
                    key={imageUrl}
                    type="button"
                    onClick={() => setActiveImage(imageUrl)}
                    className={`relative h-16 rounded-lg border overflow-hidden ${
                      activeImage === imageUrl
                        ? 'border-amber-500'
                        : 'border-stone-200'
                    }`}
                  >
                    <Image
                      src={resolveImageUrl(imageUrl)}
                      alt={`${product.name} preview`}
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </article>

          <article className="rounded-2xl border border-stone-200 bg-white shadow-sm p-5 sm:p-7">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-700 font-semibold">Gaumaya Farm</p>
            <h1 className="mt-2 text-2xl sm:text-3xl font-display font-extrabold text-stone-900">
              {product.name}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">
                Size: {normalizeSizeLabel(displaySize)}
              </span>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">
                SKU: {displaySku}
              </span>
            </div>

            <div className="mt-5">
              <p className="text-sm text-stone-500">Price</p>
              <p className="text-3xl font-black text-amber-700">{formatCurrency(displayPrice)}</p>
            </div>

            {variants.length > 0 && (
              <div className="mt-5">
                <p className="text-sm font-semibold text-stone-700 mb-2">Select Size</p>
                <div className="flex flex-wrap gap-2">
                  {variants.map((variant) => {
                    const isSelected = variant.sku === selectedVariant?.sku;
                    return (
                      <button
                        key={variant.sku}
                        type="button"
                        onClick={() => handleVariantSelect(variant.sku)}
                        className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                          isSelected
                            ? 'border-amber-600 bg-amber-50 text-amber-800'
                            : 'border-stone-300 bg-white text-stone-700'
                        }`}
                      >
                        {normalizeSizeLabel(variant.label || variant.size)} - {formatCurrency(variant.price)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="mt-5 text-stone-700 leading-relaxed">{product.description}</p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={displayStock <= 0}
                className="rounded-xl bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 disabled:cursor-not-allowed px-5 py-2.5 text-sm font-semibold text-white"
              >
                Add to Cart
              </button>
              <Link
                href="/cart"
                className="rounded-xl border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-100"
              >
                Go to Cart
              </Link>
              <AddToWishlistButton productId={product._id} />
            </div>

            <div className="mt-6 rounded-xl border border-stone-200 bg-stone-50 p-4">
              <p className="text-sm font-semibold text-stone-800">Customer rating</p>
              <p className="mt-1 text-lg font-bold text-amber-700">
                {ratingAverage > 0 ? `${ratingAverage}/5` : 'No ratings yet'}
              </p>
              <p className="text-xs text-stone-600">{ratingCount} review(s)</p>
            </div>
          </article>
        </section>

        <section className="mt-10 rounded-2xl border border-stone-200 bg-white p-5 sm:p-8">
          <h2 className="text-xl sm:text-2xl font-bold text-stone-900">Customer Reviews</h2>

          <form onSubmit={handleSubmitReview} className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            {!hasCustomerToken && (
              <input
                type="text"
                value={reviewName}
                onChange={(event) => setReviewName(event.target.value)}
                placeholder="Your name"
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
              />
            )}
            <select
              value={reviewRating}
              onChange={(event) => setReviewRating(Number(event.target.value))}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value={5}>5 - Excellent</option>
              <option value={4}>4 - Good</option>
              <option value={3}>3 - Average</option>
              <option value={2}>2 - Poor</option>
              <option value={1}>1 - Bad</option>
            </select>
            <input
              type="text"
              value={reviewTitle}
              onChange={(event) => setReviewTitle(event.target.value)}
              placeholder="Review title (optional)"
              className="md:col-span-2 border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />
            <textarea
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
              placeholder="Write your experience with this product"
              className="md:col-span-2 border border-stone-300 rounded-lg px-3 py-2 text-sm min-h-28"
            />
            <div className="md:col-span-2 flex items-center gap-3">
              <button
                type="submit"
                disabled={submittingReview}
                className="rounded-lg bg-stone-900 hover:bg-black disabled:bg-stone-400 px-4 py-2 text-sm font-semibold text-white"
              >
                {submittingReview ? 'Submitting...' : 'Submit Review'}
              </button>
              {reviewSuccess && <p className="text-sm text-emerald-700">{reviewSuccess}</p>}
              {reviewError && <p className="text-sm text-red-700">{reviewError}</p>}
            </div>
          </form>

          <div className="mt-6 space-y-4">
            {reviews.length === 0 ? (
              <p className="text-sm text-stone-600">No reviews yet. Be the first to review this product.</p>
            ) : (
              reviews.map((review) => (
                <article key={review._id ?? `${review.customerName}-${review.createdAt}`} className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-stone-900">{review.customerName}</p>
                    <p className="text-amber-700 text-sm">{toStars(review.rating)}</p>
                    {review.isVerifiedPurchase && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        Verified Purchase
                      </span>
                    )}
                  </div>
                  {review.title && (
                    <p className="mt-2 text-sm font-semibold text-stone-800">{review.title}</p>
                  )}
                  <p className="mt-1 text-sm text-stone-700">{review.comment}</p>
                </article>
              ))
            )}
          </div>
        </section>

        {relatedProducts.length > 0 && (
          <section className="mt-10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl sm:text-2xl font-bold text-stone-900">Similar Products</h2>
              <Link href="/" className="text-sm font-semibold text-amber-700 hover:text-amber-800">
                View all
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              {relatedProducts.map((related) => (
                <article key={related._id} className="rounded-2xl border border-stone-200 bg-white overflow-hidden shadow-sm">
                  <Link href={`/products/${related._id}`} className="block">
                    <div className="relative h-44 bg-stone-50 flex items-center justify-center">
                      <Image
                        src={resolveImageUrl(related.imageUrl)}
                        alt={related.name}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                        className="object-contain p-4"
                      />
                    </div>
                    <div className="p-4 border-t border-stone-100">
                      <h3 className="text-sm font-bold text-stone-900 line-clamp-2">{related.name}</h3>
                      <p className="mt-1 text-xs text-stone-500">{related.size}</p>
                      <p className="mt-2 text-lg font-black text-amber-700">{formatCurrency(related.price)}</p>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      <div
        className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur px-4 pt-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
      >
        <div className="mx-auto max-w-6xl flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {normalizeSizeLabel(displayVariantLabel)}
            </p>
            <p className="text-lg font-black text-amber-700">{formatCurrency(displayPrice)}</p>
          </div>
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={displayStock <= 0}
            className="rounded-xl bg-amber-600 px-5 py-3 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
          >
            {displayStock > 0 ? 'Add to Cart' : 'Out of Stock'}
          </button>
        </div>
      </div>
    </main>
  );
}
