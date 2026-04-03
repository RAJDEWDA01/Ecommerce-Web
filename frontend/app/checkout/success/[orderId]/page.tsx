"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { customerApiFetch } from '@/lib/customerAuth';

interface OrderItem {
  product: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface ShippingInfo {
  fullName: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  phone: string;
}

interface OrderPayload {
  _id: string;
  items: OrderItem[];
  shippingInfo: ShippingInfo;
  subtotal: number;
  discountAmount: number;
  couponCode?: string | null;
  totalAmount: number;
  paymentStatus: string;
  orderStatus: string;
  createdAt: string;
}

interface OrderApiResponse {
  success: boolean;
  message?: string;
  order?: OrderPayload;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);

export default function CheckoutSuccessPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = useMemo(() => params.orderId, [params.orderId]);

  const [order, setOrder] = useState<OrderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOrder = async () => {
      if (!orderId) {
        setError('Order id is missing');
        setLoading(false);
        return;
      }

      try {
        const response = await customerApiFetch(`/api/orders/${orderId}`, {
          cache: 'no-store',
        });

        const data = (await response.json()) as OrderApiResponse;

        if (!response.ok || !data.success || !data.order) {
          throw new Error(data.message || 'Unable to load order details');
        }

        setOrder(data.order);
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch order details');
      } finally {
        setLoading(false);
      }
    };

    fetchOrder();
  }, [orderId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6 sm:py-10 lg:p-10 flex items-center justify-center">
        <p className="text-stone-700 text-lg">Loading your order details...</p>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6 sm:py-10 lg:p-10 flex items-center justify-center">
        <div className="max-w-xl w-full bg-white border border-stone-200 rounded-2xl p-6 sm:p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-stone-800 mb-2">Order confirmation unavailable</h1>
          <p className="text-stone-600 mb-6">{error || 'We could not find this order.'}</p>
          <Link
            href="/"
            className="inline-block bg-amber-600 hover:bg-amber-700 text-white px-6 py-3 rounded-xl font-semibold"
          >
            Continue Shopping
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <section className="bg-white border border-green-100 rounded-2xl p-5 sm:p-8 shadow-sm">
          <p className="text-green-700 font-semibold uppercase text-sm tracking-wide">Order placed</p>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-stone-900 mt-2">Thank you for your purchase!</h1>
          <p className="text-stone-600 mt-3">
            Order ID: <span className="font-semibold text-stone-900">{order._id}</span>
          </p>
          <p className="text-stone-600 mt-1 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
            <span>
              Status: <span className="font-semibold capitalize">{order.orderStatus}</span>
            </span>
            <span className="hidden sm:inline">|</span>
            <span>
              Payment: <span className="font-semibold capitalize">{order.paymentStatus}</span>
            </span>
          </p>
        </section>

        <section className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-8 shadow-sm">
          <h2 className="text-xl font-bold text-stone-800 mb-4">Items</h2>
          <div className="divide-y divide-stone-100">
            {order.items.map((item) => (
              <div key={`${item.product}-${item.sku}`} className="py-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 sm:gap-3">
                <div>
                  <p className="font-semibold text-stone-800">{item.name}</p>
                  <p className="text-sm text-stone-500">
                    SKU: {item.sku} | Qty: {item.quantity}
                  </p>
                </div>
                <p className="font-bold text-stone-700">{formatCurrency(item.lineTotal)}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-6 border-t border-stone-200 flex justify-between items-center">
            <div className="w-full space-y-2">
              <div className="flex justify-between items-center text-sm text-stone-600">
                <span>Subtotal</span>
                <span>{formatCurrency(order.subtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-sm text-emerald-700">
                <span>
                  Discount
                  {order.couponCode ? (
                    <span className="ml-1 font-semibold">({order.couponCode})</span>
                  ) : null}
                </span>
                <span>- {formatCurrency(order.discountAmount || 0)}</span>
              </div>
              <div className="pt-4 mt-2 border-t border-stone-200 flex justify-between items-center">
                <span className="text-base sm:text-lg font-medium text-stone-600">Total</span>
                <span className="text-xl sm:text-2xl font-black text-amber-900">
                  {formatCurrency(order.totalAmount)}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-8 shadow-sm">
          <h2 className="text-xl font-bold text-stone-800 mb-4">Shipping details</h2>
          <p className="text-stone-700 font-semibold">{order.shippingInfo.fullName}</p>
          <p className="text-stone-600">{order.shippingInfo.address}</p>
          <p className="text-stone-600">
            {order.shippingInfo.city}, {order.shippingInfo.postalCode}
          </p>
          <p className="text-stone-600 mt-2">{order.shippingInfo.email}</p>
          <p className="text-stone-600">{order.shippingInfo.phone}</p>
        </section>

        <div className="flex justify-center">
          <Link
            href="/"
            className="bg-amber-600 hover:bg-amber-700 text-white px-8 py-3 rounded-xl font-semibold w-full sm:w-auto text-center"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    </main>
  );
}
