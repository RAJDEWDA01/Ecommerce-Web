"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buildApiUrl } from '@/lib/api';
import { clearAdminToken, getAdminToken } from '@/lib/adminAuth';

type WebhookStatus = 'processing' | 'processed' | 'failed';

interface LinkedOrder {
  _id: string;
  paymentStatus: 'pending' | 'paid' | 'failed';
  orderStatus: 'placed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  totalAmount: number;
  createdAt: string;
}

interface WebhookEvent {
  _id: string;
  eventId: string;
  eventType: string;
  status: WebhookStatus;
  attempts: number;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  lastError?: string | null;
  processedAt?: string | null;
  receivedAt: string;
  order?: LinkedOrder | null;
}

interface WebhookSummary {
  total: number;
  processed: number;
  processing: number;
  failed: number;
}

interface WebhookEventsResponse {
  success: boolean;
  message?: string;
  count?: number;
  summary?: WebhookSummary;
  events?: WebhookEvent[];
}

const DEFAULT_SUMMARY: WebhookSummary = {
  total: 0,
  processed: 0,
  processing: 0,
  failed: 0,
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

export default function AdminPaymentsPage() {
  const router = useRouter();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [summary, setSummary] = useState<WebhookSummary>(DEFAULT_SUMMARY);

  const [statusFilter, setStatusFilter] = useState<'all' | WebhookStatus>('all');
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | 'payment.captured' | 'payment.failed'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  useEffect(() => {
    const token = getAdminToken();

    if (!token) {
      router.replace('/admin/login');
      return;
    }

    setAuthToken(token);
    setIsAuthChecking(false);
  }, [router]);

  const fetchWebhookEvents = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams({ limit: '200' });

      if (statusFilter !== 'all') {
        query.set('status', statusFilter);
      }

      if (eventTypeFilter !== 'all') {
        query.set('eventType', eventTypeFilter);
      }

      if (appliedSearch) {
        query.set('search', appliedSearch);
      }

      const response = await fetch(buildApiUrl(`/api/payments/webhook-events?${query.toString()}`), {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as WebhookEventsResponse;

      if (!response.ok || !data.success || !data.events || !data.summary) {
        throw new Error(data.message || 'Failed to fetch webhook events');
      }

      setEvents(data.events);
      setSummary(data.summary);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load webhook events');
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, authToken, eventTypeFilter, router, statusFilter]);

  useEffect(() => {
    void fetchWebhookEvents();
  }, [fetchWebhookEvents]);

  const statusBadge = (status: WebhookStatus): string => {
    if (status === 'processed') {
      return 'bg-emerald-100 text-emerald-700';
    }

    if (status === 'failed') {
      return 'bg-red-100 text-red-700';
    }

    return 'bg-amber-100 text-amber-700';
  };

  const failedEvents = useMemo(() => events.filter((event) => event.status === 'failed'), [events]);

  const handleLogout = () => {
    clearAdminToken();
    router.replace('/admin/login');
  };

  if (isAuthChecking || loading) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6 sm:py-10 lg:p-10 flex items-center justify-center">
        <p className="text-lg text-stone-700">Loading payment reconciliation...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-stone-900">Payment Reconciliation</h1>
            <p className="text-stone-600 mt-2">
              Monitor webhook processing, inspect failed events, and validate payment sync.
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="self-start md:self-auto bg-stone-800 hover:bg-black text-white px-4 py-2 rounded-lg text-sm font-semibold"
          >
            Logout
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-3">
          <Link href="/admin/orders" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Orders
          </Link>
          <Link href="/admin/products" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Products
          </Link>
          <Link href="/admin/payments" className="px-3 py-2 rounded-lg text-sm font-semibold bg-amber-100 text-amber-800">
            Payments
          </Link>
          <Link href="/admin/coupons" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Coupons
          </Link>
          <Link href="/admin/support" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Support
          </Link>
          <Link href="/admin/feedback" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Feedback
          </Link>
          <Link href="/admin/audit" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Audit
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Total Events</p>
            <p className="text-3xl font-black text-stone-900 mt-1">{summary.total}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Processed</p>
            <p className="text-3xl font-black text-emerald-700 mt-1">{summary.processed}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Processing</p>
            <p className="text-3xl font-black text-amber-700 mt-1">{summary.processing}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Failed</p>
            <p className="text-3xl font-black text-red-700 mt-1">{summary.failed}</p>
          </div>
        </div>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | WebhookStatus)}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Statuses</option>
              <option value="processed">Processed</option>
              <option value="processing">Processing</option>
              <option value="failed">Failed</option>
            </select>

            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value as 'all' | 'payment.captured' | 'payment.failed')}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Event Types</option>
              <option value="payment.captured">payment.captured</option>
              <option value="payment.failed">payment.failed</option>
            </select>

            <input
              type="text"
              placeholder="Search event/order/payment ID"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAppliedSearch(searchInput.trim())}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-3 py-2 text-sm font-semibold"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setAppliedSearch('');
                  void fetchWebhookEvents();
                }}
                className="flex-1 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-lg px-3 py-2 text-sm font-semibold"
              >
                Reset
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {failedEvents.length > 0 && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-800">
              {failedEvents.length} webhook event(s) currently failed. Review `lastError` and related order mapping below.
            </p>
          </section>
        )}

        {events.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-6 sm:p-10 text-center text-stone-600">
            No webhook events found for current filters.
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((event) => (
              <article key={event._id} className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-stone-500">Event ID</p>
                    <p className="font-semibold text-stone-900 break-all">{event.eventId}</p>
                    <p className="text-sm text-stone-500 mt-1">{formatDateTime(event.receivedAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-3 py-1 rounded-full bg-stone-100 text-stone-700 text-xs font-semibold">
                      {event.eventType}
                    </span>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${statusBadge(event.status)}`}>
                      {event.status}
                    </span>
                    <span className="px-3 py-1 rounded-full bg-stone-100 text-stone-600 text-xs font-semibold">
                      Attempts: {event.attempts}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                    <p className="text-xs uppercase tracking-wide text-stone-500">Razorpay Order</p>
                    <p className="text-sm text-stone-800 break-all mt-1">
                      {event.razorpayOrderId || 'Not present'}
                    </p>
                    <p className="text-xs uppercase tracking-wide text-stone-500 mt-3">Razorpay Payment</p>
                    <p className="text-sm text-stone-800 break-all mt-1">
                      {event.razorpayPaymentId || 'Not present'}
                    </p>
                  </div>

                  <div className="rounded-xl border border-stone-100 bg-stone-50 p-4 lg:col-span-2">
                    <p className="text-xs uppercase tracking-wide text-stone-500">Linked Order</p>
                    {event.order ? (
                      <div className="mt-2 text-sm text-stone-700 space-y-1">
                        <p className="break-all font-semibold text-stone-900">#{event.order._id}</p>
                        <p>
                          Payment: <span className="capitalize">{event.order.paymentStatus}</span> | Fulfillment:{' '}
                          <span className="capitalize">{event.order.orderStatus}</span>
                        </p>
                        <p>Total: {formatCurrency(event.order.totalAmount)}</p>
                        <p>Created: {formatDateTime(event.order.createdAt)}</p>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-stone-600">No internal order mapped for this webhook event.</p>
                    )}

                    {event.lastError && (
                      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 break-words">
                        Last Error: {event.lastError}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
