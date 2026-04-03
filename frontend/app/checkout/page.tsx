"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useCartStore } from '../../store/cartStore';
import { customerApiFetch, getCustomerToken } from '@/lib/customerAuth';
import { resolveImageUrl } from '@/lib/api';

interface ShippingInfo {
  fullName: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  phone: string;
}

interface CreateOrderResponse {
  success: boolean;
  message: string;
  orderId?: string;
  subtotal?: number;
  discountAmount?: number;
  couponCode?: string | null;
  totalAmount?: number;
}

interface CreatePaymentOrderResponse {
  success: boolean;
  message?: string;
  keyId?: string;
  orderId?: string;
  razorpayOrderId?: string;
  amount?: number;
  currency?: string;
  merchantName?: string;
  description?: string;
  customer?: {
    name?: string;
    email?: string;
    contact?: string;
  };
}

interface VerifyPaymentResponse {
  success: boolean;
  message: string;
}

interface CustomerProfileResponse {
  success: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    isEmailVerified: boolean;
  };
}

interface SavedAddress {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

interface SavedAddressesResponse {
  success: boolean;
  message?: string;
  addresses?: SavedAddress[];
}

interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayFailureResponse {
  error?: {
    description?: string;
  };
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  handler: (response: RazorpaySuccessResponse) => void | Promise<void>;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
  theme?: {
    color?: string;
  };
  modal?: {
    ondismiss?: () => void;
  };
}

const generateIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

const buildPaymentVerifyIdempotencyKey = (
  orderId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string
): string => {
  return `pv-${orderId}-${razorpayOrderId}-${razorpayPaymentId}`;
};

const loadRazorpayScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }

    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const existingScript = document.getElementById('razorpay-checkout-script') as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true));
      existingScript.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.id = 'razorpay-checkout-script';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);

    document.body.appendChild(script);
  });
};

export default function CheckoutPage() {
  const router = useRouter();
  const { items, appliedCoupon, clearCart } = useCartStore();
  const cartTotal = items.reduce((total, item) => total + item.price * item.quantity, 0);
  const discountAmount = appliedCoupon ? Math.min(appliedCoupon.discountAmount, cartTotal) : 0;
  const payableTotal = Math.max(0, cartTotal - discountAmount);

  const [shippingInfo, setShippingInfo] = useState<ShippingInfo>({
    fullName: '',
    email: '',
    address: '',
    city: '',
    postalCode: '',
    phone: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isCustomerProfileLoading, setIsCustomerProfileLoading] = useState(false);
  const [isCustomerEmailVerified, setIsCustomerEmailVerified] = useState<boolean | null>(null);
  const [hasCustomerToken, setHasCustomerToken] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedSavedAddressId, setSelectedSavedAddressId] = useState('');

  useEffect(() => {
    const hydrateFromProfile = async () => {
      const token = getCustomerToken();
      setHasCustomerToken(Boolean(token));

      if (!token) {
        setIsCustomerProfileLoading(false);
        setIsCustomerEmailVerified(null);
        return;
      }

      setIsCustomerProfileLoading(true);

      try {
        const [profileResponse, addressesResponse] = await Promise.all([
          customerApiFetch('/api/auth/me', {
            cache: 'no-store',
          }),
          customerApiFetch('/api/addresses', {
            cache: 'no-store',
          }),
        ]);

        if (!profileResponse.ok) {
          setIsCustomerEmailVerified(null);
          return;
        }

        const data = (await profileResponse.json()) as CustomerProfileResponse;

        if (!data.success || !data.user) {
          setIsCustomerEmailVerified(null);
          return;
        }

        setIsCustomerEmailVerified(data.user.isEmailVerified);
        setShippingInfo((prev) => ({
          ...prev,
          fullName: prev.fullName || data.user?.name || '',
          email: prev.email || data.user?.email || '',
        }));

        if (addressesResponse.ok) {
          const addressesData = (await addressesResponse.json()) as SavedAddressesResponse;

          if (addressesData.success && addressesData.addresses) {
            const nextAddresses = addressesData.addresses;
            setSavedAddresses(nextAddresses);

            const defaultAddress = nextAddresses.find((address) => address.isDefault) || nextAddresses[0];

            if (defaultAddress) {
              setSelectedSavedAddressId(defaultAddress.id);
              setShippingInfo((prev) => ({
                ...prev,
                fullName: prev.fullName || defaultAddress.fullName,
                phone: prev.phone || defaultAddress.phone,
                address:
                  prev.address ||
                  [
                    defaultAddress.line1,
                    defaultAddress.line2,
                    defaultAddress.landmark,
                    defaultAddress.state,
                    defaultAddress.country,
                  ]
                    .filter(Boolean)
                    .join(', '),
                city: prev.city || defaultAddress.city,
                postalCode: prev.postalCode || defaultAddress.postalCode,
              }));
            }
          }
        }
      } catch {
        setIsCustomerEmailVerified(null);
        // Optional profile prefill should never block checkout.
      } finally {
        setIsCustomerProfileLoading(false);
      }
    };

    void hydrateFromProfile();
  }, []);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setShippingInfo((prev) => ({ ...prev, [name]: value }));
  };

  const handleSavedAddressSelect = (addressId: string) => {
    setSelectedSavedAddressId(addressId);

    const selectedAddress = savedAddresses.find((address) => address.id === addressId);

    if (!selectedAddress) {
      return;
    }

    setShippingInfo((prev) => ({
      ...prev,
      fullName: selectedAddress.fullName,
      phone: selectedAddress.phone,
      address: [
        selectedAddress.line1,
        selectedAddress.line2,
        selectedAddress.landmark,
        selectedAddress.state,
        selectedAddress.country,
      ]
        .filter(Boolean)
        .join(', '),
      city: selectedAddress.city,
      postalCode: selectedAddress.postalCode,
    }));
  };

  const handlePlaceOrder = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);

    if (hasCustomerToken && isCustomerProfileLoading) {
      setSubmitError('Checking account verification status. Please wait a moment and try again.');
      return;
    }

    if (hasCustomerToken && isCustomerEmailVerified === false) {
      setSubmitError('Please verify your email first from your account page before making payment.');
      return;
    }

    setIsSubmitting(true);

    try {
      const orderIdempotencyKey = generateIdempotencyKey();
      const createOrderResponse = await customerApiFetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': orderIdempotencyKey,
        },
        body: JSON.stringify({
          shippingInfo,
          cartItems: items.map((item) => ({
            productId: item.productId || item._id,
            quantity: item.quantity,
            variantSku: item.variantSku ?? undefined,
          })),
          ...(selectedSavedAddressId ? { addressId: selectedSavedAddressId } : {}),
          ...(appliedCoupon?.code ? { couponCode: appliedCoupon.code } : {}),
        }),
      });

      const orderData = (await createOrderResponse.json()) as CreateOrderResponse;

      if (!createOrderResponse.ok || !orderData.success || !orderData.orderId) {
        throw new Error(orderData.message || 'Unable to place order at the moment');
      }

      const createdOrderId = orderData.orderId;

      const paymentInitResponse = await customerApiFetch('/api/payments/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderId: createdOrderId }),
      });

      const paymentInitData = (await paymentInitResponse.json()) as CreatePaymentOrderResponse;

      if (
        !paymentInitResponse.ok ||
        !paymentInitData.success ||
        !paymentInitData.keyId ||
        !paymentInitData.razorpayOrderId ||
        !paymentInitData.amount ||
        !paymentInitData.currency
      ) {
        throw new Error(paymentInitData.message || 'Unable to initialize payment gateway');
      }

      const scriptLoaded = await loadRazorpayScript();

      if (!scriptLoaded || !window.Razorpay) {
        throw new Error('Unable to load payment gateway. Please refresh and try again.');
      }

      const razorpayOptions: RazorpayOptions = {
        key: paymentInitData.keyId,
        amount: paymentInitData.amount,
        currency: paymentInitData.currency,
        name: paymentInitData.merchantName ?? 'Gaumaya Farm',
        description: paymentInitData.description ?? 'Order payment',
        order_id: paymentInitData.razorpayOrderId,
        prefill: {
          name: paymentInitData.customer?.name ?? shippingInfo.fullName,
          email: paymentInitData.customer?.email ?? shippingInfo.email,
          contact: paymentInitData.customer?.contact ?? shippingInfo.phone,
        },
        notes: {
          internalOrderId: createdOrderId,
        },
        theme: {
          color: '#d97706',
        },
        modal: {
          ondismiss: () => {
            setSubmitError(
              `Payment window closed. Your order is saved as pending (Order ID: ${createdOrderId}).`
            );
          },
        },
        handler: async (paymentResponse: RazorpaySuccessResponse) => {
          try {
            setIsSubmitting(true);

            const verifyResponse = await customerApiFetch('/api/payments/verify', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Idempotency-Key': buildPaymentVerifyIdempotencyKey(
                  createdOrderId,
                  paymentResponse.razorpay_order_id,
                  paymentResponse.razorpay_payment_id
                ),
              },
              body: JSON.stringify({
                orderId: createdOrderId,
                razorpayOrderId: paymentResponse.razorpay_order_id,
                razorpayPaymentId: paymentResponse.razorpay_payment_id,
                razorpaySignature: paymentResponse.razorpay_signature,
              }),
            });

            const verifyData = (await verifyResponse.json()) as VerifyPaymentResponse;

            if (!verifyResponse.ok || !verifyData.success) {
              throw new Error(verifyData.message || 'Payment verification failed');
            }

            clearCart();
            router.push(`/checkout/success/${createdOrderId}`);
          } catch (verifyError) {
            setSubmitError(
              verifyError instanceof Error
                ? verifyError.message
                : 'Payment captured but verification failed. Please contact support with your order id.'
            );
          } finally {
            setIsSubmitting(false);
          }
        },
      };

      const razorpayInstance = new window.Razorpay(razorpayOptions);

      razorpayInstance.on('payment.failed', (response: unknown) => {
        const failureResponse = response as RazorpayFailureResponse;
        const failureReason = failureResponse.error?.description || 'Payment was not completed.';
        setSubmitError(`${failureReason} (Order ID: ${createdOrderId})`);
      });

      setIsSubmitting(false);
      razorpayInstance.open();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Something went wrong while processing payment');
      setIsSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 sm:px-6 sm:py-10 lg:p-10 bg-stone-50">
        <h1 className="font-display text-2xl font-bold mb-4">Your cart is empty</h1>
        <Link href="/" className="text-amber-600 hover:underline">
          Go back to shopping
        </Link>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-6xl mx-auto">
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-amber-900 mb-6 sm:mb-8 tracking-tight">Checkout</h1>

        <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
          <div className="flex-1 bg-white p-5 sm:p-8 rounded-2xl shadow-sm border border-stone-100">
            <h2 className="text-xl sm:text-2xl font-bold text-stone-800 mb-6">Shipping Details</h2>
            <form onSubmit={handlePlaceOrder} className="space-y-5">
              {savedAddresses.length > 0 && (
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Use Saved Address
                  </label>
                  <select
                    value={selectedSavedAddressId}
                    onChange={(event) => handleSavedAddressSelect(event.target.value)}
                    className="w-full border border-stone-300 rounded-lg px-4 py-2.5 text-sm bg-white"
                  >
                    <option value="">Select saved address</option>
                    {savedAddresses.map((address) => (
                      <option key={address.id} value={address.id}>
                        {address.label} - {address.fullName}, {address.city}{address.isDefault ? ' (Default)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-stone-500 mt-2">
                    Manage addresses from your account page.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Full Name</label>
                  <input
                    required
                    type="text"
                    name="fullName"
                    value={shippingInfo.fullName}
                    onChange={handleInputChange}
                    className="w-full border border-stone-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Email Address</label>
                  <input
                    required
                    type="email"
                    name="email"
                    value={shippingInfo.email}
                    onChange={handleInputChange}
                    className="w-full border border-stone-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Street Address</label>
                <input
                  required
                  type="text"
                  name="address"
                  value={shippingInfo.address}
                  onChange={handleInputChange}
                  className="w-full border border-stone-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-stone-600 mb-1">City</label>
                  <input
                    required
                    type="text"
                    name="city"
                    value={shippingInfo.city}
                    onChange={handleInputChange}
                    className="w-full border border-stone-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">PIN / Postal Code</label>
                  <input
                    required
                    type="text"
                    name="postalCode"
                    value={shippingInfo.postalCode}
                    onChange={handleInputChange}
                    className="w-full border border-stone-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Phone Number</label>
                <input
                  required
                  type="tel"
                  name="phone"
                  value={shippingInfo.phone}
                  onChange={handleInputChange}
                  className="w-full border border-stone-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                />
              </div>

              {submitError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {submitError}
                </div>
              )}

              {hasCustomerToken && isCustomerEmailVerified === false && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Email is not verified. Go to{' '}
                  <Link href="/account" className="font-semibold underline">
                    My Account
                  </Link>{' '}
                  and resend verification email.
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || (hasCustomerToken && isCustomerEmailVerified === false)}
                className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl mt-8 text-base sm:text-lg"
              >
                {isSubmitting ? 'Preparing payment...' : `Proceed to Payment (₹${payableTotal})`}
              </button>
            </form>
          </div>

          <div className="w-full lg:w-96 bg-stone-100 p-5 sm:p-8 rounded-2xl border border-stone-200 h-fit lg:sticky lg:top-24">
            <h2 className="text-lg sm:text-xl font-bold text-stone-800 mb-6">Order Summary</h2>
            <div className="divide-y divide-stone-200">
              {items.map((item) => (
                <div key={item._id} className="py-4 flex justify-between items-start gap-3">
                  <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    <Image
                      src={resolveImageUrl(item.imageUrl)}
                      alt={item.name}
                      width={48}
                      height={48}
                      className="h-10 w-10 sm:h-12 sm:w-12 object-contain bg-white rounded-md border border-stone-200 p-1 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="font-semibold text-stone-800 text-sm line-clamp-2">{item.name}</p>
                      <p className="text-stone-500 text-xs">
                        {item.variantLabel || item.size} | Qty: {item.quantity}
                      </p>
                    </div>
                  </div>
                  <p className="font-bold text-stone-700 text-sm sm:text-base shrink-0">₹{item.price * item.quantity}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-6 border-t border-stone-300 flex justify-between items-center">
              <div>
                <span className="text-base sm:text-lg font-medium text-stone-600">Total</span>
                {appliedCoupon?.code && (
                  <p className="text-xs text-emerald-700 mt-1">Coupon {appliedCoupon.code} applied</p>
                )}
              </div>
              <span className="text-xl sm:text-2xl font-black text-amber-900">₹{payableTotal}</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
