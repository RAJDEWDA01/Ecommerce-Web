"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  customerApiFetch,
  getCustomerToken,
  logoutCustomerSession,
  refreshCustomerSession,
} from '@/lib/customerAuth';

interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: 'customer';
  isEmailVerified: boolean;
}

interface OrderItem {
  product: string;
  name: string;
  sku: string;
  quantity: number;
  lineTotal: number;
}

interface FulfillmentInfo {
  courierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  packedAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
}

interface Order {
  _id: string;
  totalAmount: number;
  paymentStatus: 'pending' | 'paid' | 'failed';
  orderStatus: 'placed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  fulfillmentInfo?: FulfillmentInfo;
  refundInfo?: {
    status: 'not_required' | 'pending' | 'processed' | 'failed';
    amount: number;
    currency: 'INR';
    initiatedAt?: string | null;
    processedAt?: string | null;
    reference?: string | null;
    note?: string | null;
    gatewayRefundId?: string | null;
    gatewaySettlementStatus?: 'unknown' | 'pending' | 'settled' | 'failed';
    gatewaySettlementAt?: string | null;
  };
  cancellationRequest?: {
    status: 'none' | 'requested' | 'approved' | 'rejected';
    reason?: string | null;
    requestedAt?: string | null;
    reviewNote?: string | null;
    reviewedAt?: string | null;
  };
  createdAt: string;
  items: OrderItem[];
}

interface ProfileResponse {
  success: boolean;
  message?: string;
  user?: CustomerProfile;
}

interface OrdersResponse {
  success: boolean;
  message?: string;
  orders?: Order[];
}

interface VerificationResponse {
  success: boolean;
  message?: string;
}

interface UpdateProfileResponse {
  success: boolean;
  message?: string;
  user?: CustomerProfile;
}

interface RequestCancellationResponse {
  success: boolean;
  message?: string;
  orderId?: string;
  orderStatus?: Order['orderStatus'];
  cancellationRequest?: Order['cancellationRequest'];
}

interface CustomerAddress {
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
  createdAt: string;
  updatedAt: string;
}

interface AddressesResponse {
  success: boolean;
  message?: string;
  addresses?: CustomerAddress[];
}

interface AddressMutationResponse {
  success: boolean;
  message?: string;
  address?: CustomerAddress;
}

interface AddressFormState {
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

const DEFAULT_ADDRESS_FORM: AddressFormState = {
  label: 'Home',
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  landmark: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'India',
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

export default function AccountPage() {
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileUpdateMessage, setProfileUpdateMessage] = useState<string | null>(null);
  const [profileUpdateError, setProfileUpdateError] = useState<string | null>(null);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [addressForm, setAddressForm] = useState<AddressFormState>(DEFAULT_ADDRESS_FORM);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [isSavingAddress, setIsSavingAddress] = useState(false);
  const [addressMessage, setAddressMessage] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [settingDefaultAddressId, setSettingDefaultAddressId] = useState<string | null>(null);
  const [deletingAddressId, setDeletingAddressId] = useState<string | null>(null);
  const [requestingCancellationOrderIds, setRequestingCancellationOrderIds] = useState<string[]>([]);

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
    const fetchAccountData = async () => {
      if (!token) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [profileRes, ordersRes, addressesRes] = await Promise.all([
          customerApiFetch('/api/auth/me', {
            cache: 'no-store',
          }),
          customerApiFetch('/api/orders/my-orders', {
            cache: 'no-store',
          }),
          customerApiFetch('/api/addresses', {
            cache: 'no-store',
          }),
        ]);

        if (
          profileRes.status === 401 ||
          profileRes.status === 403 ||
          ordersRes.status === 401 ||
          ordersRes.status === 403 ||
          addressesRes.status === 401 ||
          addressesRes.status === 403
        ) {
          await logoutCustomerSession();
          router.replace('/account/login');
          return;
        }

        const profileData = (await profileRes.json()) as ProfileResponse;
        const ordersData = (await ordersRes.json()) as OrdersResponse;
        const addressesData = (await addressesRes.json()) as AddressesResponse;

        if (!profileRes.ok || !profileData.success || !profileData.user) {
          throw new Error(profileData.message || 'Failed to load account profile');
        }

        if (!ordersRes.ok || !ordersData.success || !ordersData.orders) {
          throw new Error(ordersData.message || 'Failed to load order history');
        }

        if (!addressesRes.ok || !addressesData.success || !addressesData.addresses) {
          throw new Error(addressesData.message || 'Failed to load saved addresses');
        }

        const profileUser = profileData.user;

        setProfile(profileUser);
        setProfileName(profileUser.name);
        setProfilePhone(profileUser.phone || '');
        setOrders(ordersData.orders);
        setAddresses(addressesData.addresses);
        setAddressForm((prev) => ({
          ...prev,
          fullName: prev.fullName || profileUser.name,
          phone: prev.phone || profileUser.phone || '',
        }));
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load account');
      } finally {
        setLoading(false);
      }
    };

    fetchAccountData();
  }, [token, router]);

  const handleLogout = async () => {
    await logoutCustomerSession();
    router.replace('/account/login');
  };

  const handleResendVerification = async () => {
    setVerificationMessage(null);
    setVerificationError(null);
    setIsSendingVerification(true);

    try {
      const response = await customerApiFetch('/api/auth/verify-email/resend', {
        method: 'POST',
      });
      const data = (await response.json()) as VerificationResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Unable to resend verification email');
      }

      setVerificationMessage(data.message || 'Verification email sent.');
    } catch (sendError) {
      setVerificationError(sendError instanceof Error ? sendError.message : 'Unable to resend verification email');
    } finally {
      setIsSendingVerification(false);
    }
  };

  const handleProfileSave = async () => {
    setProfileUpdateMessage(null);
    setProfileUpdateError(null);
    setIsSavingProfile(true);

    try {
      const response = await customerApiFetch('/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: profileName,
          phone: profilePhone || null,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        await logoutCustomerSession();
        router.replace('/account/login');
        return;
      }

      const data = (await response.json()) as UpdateProfileResponse;

      if (!response.ok || !data.success || !data.user) {
        throw new Error(data.message || 'Failed to update profile');
      }

      setProfile(data.user);
      setProfileName(data.user.name);
      setProfilePhone(data.user.phone || '');
      setProfileUpdateMessage(data.message || 'Profile updated successfully');
    } catch (updateError) {
      setProfileUpdateError(updateError instanceof Error ? updateError.message : 'Failed to update profile');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const resetAddressForm = () => {
    setEditingAddressId(null);
    setAddressForm({
      ...DEFAULT_ADDRESS_FORM,
      fullName: profile?.name || '',
      phone: profile?.phone || '',
    });
  };

  const refreshAddresses = async () => {
    const response = await customerApiFetch('/api/addresses', {
      cache: 'no-store',
    });

    if (response.status === 401 || response.status === 403) {
      await logoutCustomerSession();
      router.replace('/account/login');
      return false;
    }

    const data = (await response.json()) as AddressesResponse;

    if (!response.ok || !data.success || !data.addresses) {
      throw new Error(data.message || 'Failed to fetch saved addresses');
    }

    setAddresses(data.addresses);
    return true;
  };

  const handleAddressSave = async () => {
    setAddressMessage(null);
    setAddressError(null);
    setIsSavingAddress(true);

    try {
      const endpoint = editingAddressId
        ? `/api/addresses/${editingAddressId}`
        : '/api/addresses';
      const method = editingAddressId ? 'PATCH' : 'POST';

      const response = await customerApiFetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          label: addressForm.label,
          fullName: addressForm.fullName,
          phone: addressForm.phone,
          line1: addressForm.line1,
          line2: addressForm.line2 || null,
          landmark: addressForm.landmark || null,
          city: addressForm.city,
          state: addressForm.state,
          postalCode: addressForm.postalCode,
          country: addressForm.country,
          ...(editingAddressId ? {} : { isDefault: addresses.length === 0 }),
        }),
      });

      if (response.status === 401 || response.status === 403) {
        await logoutCustomerSession();
        router.replace('/account/login');
        return;
      }

      const data = (await response.json()) as AddressMutationResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to save address');
      }

      await refreshAddresses();
      resetAddressForm();
      setAddressMessage(editingAddressId ? 'Address updated successfully' : 'Address added successfully');
    } catch (saveError) {
      setAddressError(saveError instanceof Error ? saveError.message : 'Failed to save address');
    } finally {
      setIsSavingAddress(false);
    }
  };

  const handleAddressEdit = (address: CustomerAddress) => {
    setEditingAddressId(address.id);
    setAddressMessage(null);
    setAddressError(null);
    setAddressForm({
      label: address.label,
      fullName: address.fullName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2 || '',
      landmark: address.landmark || '',
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
    });
  };

  const handleAddressDelete = async (addressId: string) => {
    const confirmed = window.confirm('Delete this address?');

    if (!confirmed) {
      return;
    }

    setAddressMessage(null);
    setAddressError(null);
    setDeletingAddressId(addressId);

    try {
      const response = await customerApiFetch(`/api/addresses/${addressId}`, {
        method: 'DELETE',
      });

      if (response.status === 401 || response.status === 403) {
        await logoutCustomerSession();
        router.replace('/account/login');
        return;
      }

      const data = (await response.json()) as { success?: boolean; message?: string };

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to delete address');
      }

      if (editingAddressId === addressId) {
        resetAddressForm();
      }

      await refreshAddresses();
      setAddressMessage('Address deleted successfully');
    } catch (deleteError) {
      setAddressError(deleteError instanceof Error ? deleteError.message : 'Failed to delete address');
    } finally {
      setDeletingAddressId(null);
    }
  };

  const handleSetDefaultAddress = async (addressId: string) => {
    setAddressMessage(null);
    setAddressError(null);
    setSettingDefaultAddressId(addressId);

    try {
      const response = await customerApiFetch(`/api/addresses/${addressId}/default`, {
        method: 'PATCH',
      });

      if (response.status === 401 || response.status === 403) {
        await logoutCustomerSession();
        router.replace('/account/login');
        return;
      }

      const data = (await response.json()) as AddressMutationResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to set default address');
      }

      await refreshAddresses();
      setAddressMessage('Default address updated');
    } catch (setDefaultError) {
      setAddressError(setDefaultError instanceof Error ? setDefaultError.message : 'Failed to set default address');
    } finally {
      setSettingDefaultAddressId(null);
    }
  };

  const handleRequestCancellation = async (orderId: string) => {
    const reason = window.prompt('Please tell us why you want to cancel this order:', 'Changed my mind');

    if (reason === null) {
      return;
    }

    const trimmedReason = reason.trim();

    if (!trimmedReason) {
      setError('Cancellation reason is required');
      return;
    }

    setError(null);
    setRequestingCancellationOrderIds((prev) => [...prev, orderId]);

    try {
      const response = await customerApiFetch(`/api/orders/${orderId}/cancellation-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: trimmedReason }),
      });

      if (response.status === 401 || response.status === 403) {
        await logoutCustomerSession();
        router.replace('/account/login');
        return;
      }

      const data = (await response.json()) as RequestCancellationResponse;

      if (!response.ok || !data.success || !data.cancellationRequest) {
        throw new Error(data.message || 'Failed to request cancellation');
      }

      setOrders((prev) =>
        prev.map((order) =>
          order._id === orderId
            ? {
                ...order,
                orderStatus: data.orderStatus ?? order.orderStatus,
                cancellationRequest: data.cancellationRequest ?? order.cancellationRequest,
              }
            : order
        )
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to request cancellation');
    } finally {
      setRequestingCancellationOrderIds((prev) => prev.filter((id) => id !== orderId));
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6 sm:py-10 lg:p-10 flex items-center justify-center">
        <p className="text-lg text-stone-700">Loading account...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 shadow-sm">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-stone-900">My Account</h1>
            {profile && (
              <p className="text-stone-600 mt-1">
                {profile.name} ({profile.email})
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/" className="bg-stone-200 hover:bg-stone-300 text-stone-800 px-4 py-2 rounded-lg text-sm font-semibold">
              Shop
            </Link>
            <button
              type="button"
              onClick={() => {
                void handleLogout();
              }}
              className="bg-stone-800 hover:bg-black text-white px-4 py-2 rounded-lg text-sm font-semibold"
            >
              Logout
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {profile && (
          <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 shadow-sm">
            <h2 className="text-xl sm:text-2xl font-bold text-stone-900">Profile</h2>
            <p className="text-sm text-stone-600 mt-1">
              Keep your account details updated for smooth checkout and support.
            </p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-stone-600 mb-1">Name</label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-600 mb-1">Phone</label>
                <input
                  type="tel"
                  value={profilePhone}
                  onChange={(event) => setProfilePhone(event.target.value)}
                  placeholder="Optional"
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={isSavingProfile}
                onClick={() => {
                  void handleProfileSave();
                }}
                className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white px-4 py-2 rounded-lg text-sm font-semibold"
              >
                {isSavingProfile ? 'Saving...' : 'Save Profile'}
              </button>
              {profileUpdateMessage && (
                <p className="text-sm text-emerald-700">{profileUpdateMessage}</p>
              )}
              {profileUpdateError && (
                <p className="text-sm text-red-700">{profileUpdateError}</p>
              )}
            </div>
          </section>
        )}

        {profile && (
          <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-stone-900">Saved Addresses</h2>
                <p className="text-sm text-stone-600 mt-1">
                  Manage delivery addresses and set one as default for faster checkout.
                </p>
              </div>
              {editingAddressId && (
                <button
                  type="button"
                  onClick={resetAddressForm}
                  className="text-sm font-semibold text-stone-600 hover:text-stone-900"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-stone-600 mb-1">Label</label>
                <input
                  type="text"
                  value={addressForm.label}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, label: event.target.value }))
                  }
                  placeholder="Home / Work"
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-600 mb-1">Full Name</label>
                <input
                  type="text"
                  value={addressForm.fullName}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, fullName: event.target.value }))
                  }
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-600 mb-1">Phone</label>
                <input
                  type="tel"
                  value={addressForm.phone}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, phone: event.target.value }))
                  }
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-600 mb-1">Country</label>
                <input
                  type="text"
                  value={addressForm.country}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, country: event.target.value }))
                  }
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-stone-600 mb-1">Address Line 1</label>
                <input
                  type="text"
                  value={addressForm.line1}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, line1: event.target.value }))
                  }
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-600 mb-1">Address Line 2 (optional)</label>
                <input
                  type="text"
                  value={addressForm.line2}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, line2: event.target.value }))
                  }
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-600 mb-1">Landmark (optional)</label>
                <input
                  type="text"
                  value={addressForm.landmark}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, landmark: event.target.value }))
                  }
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-600 mb-1">City</label>
                <input
                  type="text"
                  value={addressForm.city}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, city: event.target.value }))
                  }
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-600 mb-1">State</label>
                <input
                  type="text"
                  value={addressForm.state}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, state: event.target.value }))
                  }
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-600 mb-1">Postal Code</label>
                <input
                  type="text"
                  value={addressForm.postalCode}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, postalCode: event.target.value }))
                  }
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={isSavingAddress}
                onClick={() => {
                  void handleAddressSave();
                }}
                className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white px-4 py-2 rounded-lg text-sm font-semibold"
              >
                {isSavingAddress
                  ? 'Saving...'
                  : editingAddressId
                    ? 'Update Address'
                    : 'Add Address'}
              </button>
              <button
                type="button"
                onClick={resetAddressForm}
                className="bg-stone-200 hover:bg-stone-300 text-stone-800 px-4 py-2 rounded-lg text-sm font-semibold"
              >
                Reset
              </button>
              {addressMessage && <p className="text-sm text-emerald-700">{addressMessage}</p>}
              {addressError && <p className="text-sm text-red-700">{addressError}</p>}
            </div>

            <div className="mt-6 space-y-3">
              {addresses.length === 0 ? (
                <p className="text-stone-600 text-sm">No saved addresses yet.</p>
              ) : (
                addresses.map((address) => (
                  <article
                    key={address.id}
                    className="rounded-xl border border-stone-200 bg-stone-50 p-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-stone-900">{address.label}</p>
                          {address.isDefault && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                              Default
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-stone-700 mt-1">{address.fullName}</p>
                        <p className="text-sm text-stone-700">{address.phone}</p>
                        <p className="text-sm text-stone-600 mt-1">
                          {[address.line1, address.line2, address.landmark].filter(Boolean).join(', ')}
                        </p>
                        <p className="text-sm text-stone-600">
                          {address.city}, {address.state} {address.postalCode}, {address.country}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!address.isDefault && (
                          <button
                            type="button"
                            disabled={settingDefaultAddressId === address.id}
                            onClick={() => {
                              void handleSetDefaultAddress(address.id);
                            }}
                            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white px-3 py-2 rounded-lg text-xs font-semibold"
                          >
                            {settingDefaultAddressId === address.id ? 'Setting...' : 'Set Default'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleAddressEdit(address)}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-semibold"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={deletingAddressId === address.id}
                          onClick={() => {
                            void handleAddressDelete(address.id);
                          }}
                          className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white px-3 py-2 rounded-lg text-xs font-semibold"
                        >
                          {deletingAddressId === address.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        )}

        {profile && !profile.isEmailVerified && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6 shadow-sm">
            <h2 className="text-xl font-bold text-amber-900">Verify Your Email</h2>
            <p className="text-amber-800 mt-2 text-sm">
              Verify your email to strengthen account security and ensure delivery of order updates.
            </p>
            <button
              type="button"
              disabled={isSendingVerification}
              onClick={() => {
                void handleResendVerification();
              }}
              className="mt-4 bg-amber-700 hover:bg-amber-800 disabled:bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-semibold"
            >
              {isSendingVerification ? 'Sending...' : 'Resend Verification Email'}
            </button>
            {verificationMessage && (
              <p className="mt-3 text-sm text-emerald-700">{verificationMessage}</p>
            )}
            {verificationError && (
              <p className="mt-3 text-sm text-red-700">{verificationError}</p>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 shadow-sm">
          <h2 className="text-xl sm:text-2xl font-bold text-stone-900 mb-4">Order History</h2>

          {orders.length === 0 ? (
            <p className="text-stone-600">No orders found for your account yet.</p>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => (
                <article key={order._id} className="rounded-xl border border-stone-200 p-4 sm:p-5 bg-stone-50">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-stone-500">Order ID</p>
                      <p className="font-semibold text-stone-900 break-all">{order._id}</p>
                    </div>
                    <div className="text-sm text-stone-600">{formatDateTime(order.createdAt)}</div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="px-3 py-1 rounded-full bg-stone-200 text-stone-700 text-xs font-semibold capitalize">
                      {order.orderStatus}
                    </span>
                    <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold capitalize">
                      {order.paymentStatus}
                    </span>
                    {order.cancellationRequest?.status && order.cancellationRequest.status !== 'none' && (
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${
                          order.cancellationRequest.status === 'requested'
                            ? 'bg-amber-100 text-amber-700'
                            : order.cancellationRequest.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-red-100 text-red-700'
                        }`}
                      >
                        cancellation {order.cancellationRequest.status}
                      </span>
                    )}
                  </div>

                  <ul className="mt-4 space-y-2 text-sm text-stone-700">
                    {order.items.map((item) => (
                      <li key={`${order._id}-${item.sku}`} className="flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span>
                          {item.name} x {item.quantity}
                        </span>
                        <span>{formatCurrency(item.lineTotal)}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 pt-3 border-t border-stone-200 flex justify-between font-bold text-stone-900">
                    <span>Total</span>
                    <span>{formatCurrency(order.totalAmount)}</span>
                  </div>

                  {(order.fulfillmentInfo?.courierName ||
                    order.fulfillmentInfo?.trackingNumber ||
                    order.fulfillmentInfo?.trackingUrl ||
                    order.fulfillmentInfo?.packedAt ||
                    order.fulfillmentInfo?.shippedAt ||
                    order.fulfillmentInfo?.deliveredAt) && (
                    <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                      <p className="font-semibold mb-1">Delivery Tracking</p>
                      {order.fulfillmentInfo?.courierName && (
                        <p>
                          <span className="font-semibold">Courier:</span> {order.fulfillmentInfo.courierName}
                        </p>
                      )}
                      {order.fulfillmentInfo?.trackingNumber && (
                        <p className="mt-1">
                          <span className="font-semibold">Tracking number:</span> {order.fulfillmentInfo.trackingNumber}
                        </p>
                      )}
                      {order.fulfillmentInfo?.trackingUrl && (
                        <p className="mt-1 break-all">
                          <span className="font-semibold">Tracking link:</span>{' '}
                          <a
                            href={order.fulfillmentInfo.trackingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            Open courier tracking
                          </a>
                        </p>
                      )}
                      {order.fulfillmentInfo?.packedAt && (
                        <p className="mt-1">
                          <span className="font-semibold">Packed at:</span> {formatDateTime(order.fulfillmentInfo.packedAt)}
                        </p>
                      )}
                      {order.fulfillmentInfo?.shippedAt && (
                        <p className="mt-1">
                          <span className="font-semibold">Shipped at:</span> {formatDateTime(order.fulfillmentInfo.shippedAt)}
                        </p>
                      )}
                      {order.fulfillmentInfo?.deliveredAt && (
                        <p className="mt-1">
                          <span className="font-semibold">Delivered at:</span>{' '}
                          {formatDateTime(order.fulfillmentInfo.deliveredAt)}
                        </p>
                      )}
                    </div>
                  )}

                  {(order.orderStatus === 'placed' || order.orderStatus === 'processing') &&
                    order.cancellationRequest?.status !== 'requested' && (
                      <div className="mt-3">
                        <button
                          type="button"
                          disabled={requestingCancellationOrderIds.includes(order._id)}
                          onClick={() => {
                            void handleRequestCancellation(order._id);
                          }}
                          className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white px-3 py-2 rounded-lg text-xs font-semibold"
                        >
                          {requestingCancellationOrderIds.includes(order._id)
                            ? 'Submitting...'
                            : 'Request Cancellation'}
                        </button>
                      </div>
                    )}

                  {order.cancellationRequest?.status &&
                    order.cancellationRequest.status !== 'none' && (
                      <div className="mt-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-700">
                        <p className="font-semibold text-stone-800 mb-1">Cancellation Timeline</p>
                        {order.cancellationRequest.reason && (
                          <p>
                            <span className="font-semibold">Reason:</span> {order.cancellationRequest.reason}
                          </p>
                        )}
                        {order.cancellationRequest.requestedAt && (
                          <p className="mt-1">
                            <span className="font-semibold">Requested at:</span>{' '}
                            {formatDateTime(order.cancellationRequest.requestedAt)}
                          </p>
                        )}
                        {order.cancellationRequest.status !== 'requested' &&
                          order.cancellationRequest.reviewedAt && (
                            <p className="mt-1">
                              <span className="font-semibold">Reviewed at:</span>{' '}
                              {formatDateTime(order.cancellationRequest.reviewedAt)}
                            </p>
                          )}
                        {order.cancellationRequest.reviewNote && (
                          <p className="mt-1">
                            <span className="font-semibold">Admin note:</span>{' '}
                            {order.cancellationRequest.reviewNote}
                          </p>
                        )}
                      </div>
                    )}

                  {order.refundInfo &&
                    order.refundInfo.status !== 'not_required' && (
                      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                        <p className="font-semibold mb-1">Refund Timeline</p>
                        <p>
                          <span className="font-semibold">Status:</span>{' '}
                          <span className="capitalize">{order.refundInfo.status}</span>
                        </p>
                        <p className="mt-1">
                          <span className="font-semibold">Amount:</span>{' '}
                          {formatCurrency(order.refundInfo.amount)}
                        </p>
                        {order.refundInfo.initiatedAt && (
                          <p className="mt-1">
                            <span className="font-semibold">Initiated at:</span>{' '}
                            {formatDateTime(order.refundInfo.initiatedAt)}
                          </p>
                        )}
                        {order.refundInfo.processedAt && (
                          <p className="mt-1">
                            <span className="font-semibold">Processed at:</span>{' '}
                            {formatDateTime(order.refundInfo.processedAt)}
                          </p>
                        )}
                        {order.refundInfo.reference && (
                          <p className="mt-1">
                            <span className="font-semibold">Reference:</span>{' '}
                            {order.refundInfo.reference}
                          </p>
                        )}
                        {order.refundInfo.gatewayRefundId && (
                          <p className="mt-1">
                            <span className="font-semibold">Gateway refund id:</span>{' '}
                            {order.refundInfo.gatewayRefundId}
                          </p>
                        )}
                        {order.refundInfo.gatewaySettlementStatus && (
                          <p className="mt-1">
                            <span className="font-semibold">Settlement status:</span>{' '}
                            <span className="capitalize">{order.refundInfo.gatewaySettlementStatus}</span>
                          </p>
                        )}
                        {order.refundInfo.gatewaySettlementAt && (
                          <p className="mt-1">
                            <span className="font-semibold">Settlement at:</span>{' '}
                            {formatDateTime(order.refundInfo.gatewaySettlementAt)}
                          </p>
                        )}
                        {order.refundInfo.note && (
                          <p className="mt-1">
                            <span className="font-semibold">Note:</span>{' '}
                            {order.refundInfo.note}
                          </p>
                        )}
                      </div>
                    )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
