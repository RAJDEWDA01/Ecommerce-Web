"use client";

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useCartStore } from '../../store/cartStore';
import { customerApiFetch } from '@/lib/customerAuth';
import { resolveImageUrl } from '@/lib/api';

interface ValidateCouponResponse {
  success: boolean;
  message?: string;
  coupon?: {
    code: string;
    discountAmount: number;
    finalAmount: number;
  };
}

export default function CartPage() {
  const { items, appliedCoupon, removeFromCart, setAppliedCoupon } = useCartStore();
  const [couponCode, setCouponCode] = useState(appliedCoupon?.code ?? '');
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  const cartTotal = items.reduce((total, item) => total + item.price * item.quantity, 0);
  const discountAmount = appliedCoupon ? Math.min(appliedCoupon.discountAmount, cartTotal) : 0;
  const payableTotal = Math.max(0, cartTotal - discountAmount);

  const handleApplyCoupon = async () => {
    const normalizedCouponCode = couponCode.trim().toUpperCase();

    if (!normalizedCouponCode) {
      setCouponError('Please enter a coupon code');
      setCouponMessage(null);
      return;
    }

    if (cartTotal <= 0) {
      setCouponError('Add items in cart before applying a coupon');
      setCouponMessage(null);
      return;
    }

    setIsApplyingCoupon(true);
    setCouponError(null);
    setCouponMessage(null);

    try {
      const response = await customerApiFetch('/api/coupons/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: normalizedCouponCode,
          subtotal: cartTotal,
        }),
      });

      const data = (await response.json()) as ValidateCouponResponse;

      if (!response.ok || !data.success || !data.coupon) {
        setAppliedCoupon(null);
        throw new Error(data.message || 'Unable to apply coupon');
      }

      setAppliedCoupon({
        code: data.coupon.code,
        discountAmount: data.coupon.discountAmount,
        finalAmount: data.coupon.finalAmount,
      });
      setCouponCode(data.coupon.code);
      setCouponMessage(data.message || 'Coupon applied successfully');
    } catch (error) {
      setCouponError(error instanceof Error ? error.message : 'Unable to apply coupon');
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponMessage(null);
    setCouponError(null);
  };

  if (items.length === 0) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6 sm:py-10 lg:p-10 flex flex-col items-center justify-center">
        <div className="bg-white p-6 sm:p-10 lg:p-12 rounded-2xl shadow-sm text-center border border-stone-100 w-full max-w-xl">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-800 mb-4">Your Cart is Empty</h1>
          <p className="text-stone-500 mb-8">Looks like you haven&apos;t added any pure Ghee yet!</p>
          <Link href="/" className="inline-block bg-amber-600 hover:bg-amber-700 text-white px-8 py-3 rounded-xl font-semibold">
            Continue Shopping
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-amber-900 mb-6 sm:mb-8 tracking-tight">Shopping Cart</h1>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
          <div className="divide-y divide-stone-100">
            {items.map((item) => (
              <div
                key={item._id}
                className="p-4 sm:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 hover:bg-stone-50"
              >
                <div className="flex items-center gap-4 sm:gap-6 min-w-0">
                  <div className="relative h-16 w-16 sm:h-24 sm:w-24 bg-white rounded-xl border border-stone-100 shadow-sm shrink-0 overflow-hidden">
                    <Image
                      src={resolveImageUrl(item.imageUrl)}
                      alt={item.name}
                      fill
                      sizes="(max-width: 640px) 64px, 96px"
                      className="object-contain p-2"
                    />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg sm:text-xl font-bold text-stone-800 break-words">{item.name}</h2>
                    <p className="text-stone-500 text-sm mt-1">
                      Size: {item.variantLabel || item.size}
                      {item.sku ? ` | SKU: ${item.sku}` : ''}
                    </p>
                    <p className="text-amber-600 font-bold mt-2 text-base sm:text-lg">₹{item.price}</p>
                  </div>
                </div>

                <div className="flex w-full md:w-auto items-center justify-between md:justify-start gap-4 sm:gap-8">
                  <div className="bg-stone-100 px-4 py-2 rounded-lg text-stone-700 font-semibold">
                    Qty: {item.quantity}
                  </div>
                  <button
                    onClick={() => removeFromCart(item._id)}
                    className="text-red-500 hover:text-red-700 font-semibold text-sm hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="px-4 sm:px-8 pt-6 pb-2 bg-stone-50 border-t border-stone-100">
            <h2 className="text-sm font-bold text-stone-700 uppercase tracking-wide">Apply Coupon</h2>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={couponCode}
                onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                placeholder="Enter coupon code"
                className="flex-1 border border-stone-300 rounded-lg px-4 py-2.5 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  void handleApplyCoupon();
                }}
                disabled={isApplyingCoupon}
                className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white px-4 py-2.5 rounded-lg text-sm font-semibold"
              >
                {isApplyingCoupon ? 'Applying...' : 'Apply'}
              </button>
              {appliedCoupon && (
                <button
                  type="button"
                  onClick={handleRemoveCoupon}
                  className="bg-stone-200 hover:bg-stone-300 text-stone-800 px-4 py-2.5 rounded-lg text-sm font-semibold"
                >
                  Remove
                </button>
              )}
            </div>

            {couponMessage && (
              <p className="mt-2 text-sm text-emerald-700">{couponMessage}</p>
            )}
            {couponError && (
              <p className="mt-2 text-sm text-red-700">{couponError}</p>
            )}
          </div>

          <div className="p-4 sm:p-8 bg-stone-50 flex flex-col items-stretch sm:items-end">
            <div className="flex justify-between w-full max-w-sm text-base sm:text-lg font-medium text-stone-600 mb-3">
              <span>Subtotal</span>
              <span>₹{cartTotal}</span>
            </div>
            <div className="flex justify-between w-full max-w-sm text-base font-medium text-emerald-700 mb-3">
              <span>Discount</span>
              <span>- ₹{discountAmount}</span>
            </div>
            <div className="flex justify-between w-full max-w-sm text-xl sm:text-2xl font-black text-amber-900 mb-3 border-t border-stone-200 pt-4">
              <span>Total</span>
              <span>₹{payableTotal}</span>
            </div>
            {appliedCoupon && (
              <p className="w-full max-w-sm text-xs text-stone-500 mb-6">
                Coupon <span className="font-semibold">{appliedCoupon.code}</span> is attached and will be revalidated during checkout.
              </p>
            )}

            <Link
              href="/checkout"
              className="bg-green-600 hover:bg-green-700 text-white px-8 py-4 rounded-xl font-bold w-full max-w-sm text-center text-base sm:text-lg"
            >
              Proceed to Checkout
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
