"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buildApiUrl } from '@/lib/api';
import { clearAdminToken, getAdminToken } from '@/lib/adminAuth';

type FeedbackStatus = 'new' | 'reviewed' | 'archived';

interface FeedbackEntry {
  _id: string;
  customer?: string | null;
  name: string;
  email: string;
  phone?: string | null;
  rating: number;
  message: string;
  status: FeedbackStatus;
  adminNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FeedbackListResponse {
  success: boolean;
  message?: string;
  feedback?: FeedbackEntry[];
  pagination?: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

interface UpdateFeedbackResponse {
  success: boolean;
  message?: string;
  feedback?: FeedbackEntry;
}

const STATUS_OPTIONS: FeedbackStatus[] = ['new', 'reviewed', 'archived'];
const FEEDBACK_PAGE_LIMIT = 25;

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

export default function AdminFeedbackPage() {
  const router = useRouter();
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [updatingIds, setUpdatingIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [draftStatus, setDraftStatus] = useState<Record<string, FeedbackStatus>>({});
  const [draftAdminNote, setDraftAdminNote] = useState<Record<string, string>>({});
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [feedbackPagination, setFeedbackPagination] = useState<{
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | FeedbackStatus>('all');
  const [ratingFilter, setRatingFilter] = useState<'all' | '1' | '2' | '3' | '4' | '5'>('all');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const token = getAdminToken();

    if (!token) {
      router.replace('/admin/login');
      return;
    }

    setAuthToken(token);
    setIsAuthChecking(false);
  }, [router]);

  const fetchFeedback = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams({
        limit: String(FEEDBACK_PAGE_LIMIT),
        page: String(currentPage),
      });

      if (statusFilter !== 'all') {
        query.set('status', statusFilter);
      }

      if (ratingFilter !== 'all') {
        query.set('rating', ratingFilter);
      }

      if (appliedSearch.trim()) {
        query.set('search', appliedSearch.trim());
      }

      const response = await fetch(buildApiUrl(`/api/admin/feedback?${query.toString()}`), {
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

      const data = (await response.json()) as FeedbackListResponse;

      if (!response.ok || !data.success || !data.feedback || !data.pagination) {
        throw new Error(data.message || 'Failed to fetch feedback');
      }

      setFeedback(data.feedback);
      setFeedbackPagination(data.pagination);
      setDraftStatus(
        data.feedback.reduce<Record<string, FeedbackStatus>>((acc, item) => {
          acc[item._id] = item.status;
          return acc;
        }, {})
      );
      setDraftAdminNote(
        data.feedback.reduce<Record<string, string>>((acc, item) => {
          acc[item._id] = item.adminNote ?? '';
          return acc;
        }, {})
      );
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load feedback');
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, authToken, currentPage, ratingFilter, router, statusFilter]);

  useEffect(() => {
    void fetchFeedback();
  }, [fetchFeedback]);

  const handleUpdateFeedback = async (feedbackId: string) => {
    if (!authToken) {
      return;
    }

    const nextStatus = draftStatus[feedbackId];

    if (!nextStatus) {
      return;
    }

    try {
      setUpdatingIds((prev) => [...prev, feedbackId]);
      setError(null);
      setSuccess(null);

      const response = await fetch(buildApiUrl(`/api/admin/feedback/${feedbackId}/status`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          status: nextStatus,
          adminNote: draftAdminNote[feedbackId] || null,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as UpdateFeedbackResponse;

      if (!response.ok || !data.success || !data.feedback) {
        throw new Error(data.message || 'Failed to update feedback');
      }

      setFeedback((prev) =>
        prev.map((item) =>
          item._id === feedbackId ? (data.feedback as FeedbackEntry) : item
        )
      );
      setSuccess('Feedback updated successfully');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update feedback');
    } finally {
      setUpdatingIds((prev) => prev.filter((id) => id !== feedbackId));
    }
  };

  const summary = useMemo(() => {
    return {
      total: feedbackPagination?.totalCount ?? feedback.length,
      newCount: feedback.filter((item) => item.status === 'new').length,
      reviewedCount: feedback.filter((item) => item.status === 'reviewed').length,
      archivedCount: feedback.filter((item) => item.status === 'archived').length,
    };
  }, [feedback, feedbackPagination?.totalCount]);

  const handleLogout = () => {
    clearAdminToken();
    router.replace('/admin/login');
  };

  if (isAuthChecking || loading) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6 sm:py-10 lg:p-10 flex items-center justify-center">
        <p className="text-lg text-stone-700">Loading feedback...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-stone-900">Customer Feedback</h1>
            <p className="text-stone-600 mt-2">Review product and service sentiment from customers.</p>
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
          <Link href="/admin/payments" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Payments
          </Link>
          <Link href="/admin/coupons" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Coupons
          </Link>
          <Link href="/admin/support" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Support
          </Link>
          <Link href="/admin/feedback" className="px-3 py-2 rounded-lg text-sm font-semibold bg-amber-100 text-amber-800">
            Feedback
          </Link>
          <Link href="/admin/audit" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Audit
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Total Feedback</p>
            <p className="text-3xl font-black text-stone-900 mt-1">{summary.total}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">New (Page)</p>
            <p className="text-3xl font-black text-red-700 mt-1">{summary.newCount}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Reviewed (Page)</p>
            <p className="text-3xl font-black text-amber-700 mt-1">{summary.reviewedCount}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Archived (Page)</p>
            <p className="text-3xl font-black text-emerald-700 mt-1">{summary.archivedCount}</p>
          </div>
        </div>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              type="text"
              placeholder="Search by name/email/message"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="md:col-span-2 border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as 'all' | FeedbackStatus);
                setCurrentPage(1);
              }}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Status</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              value={ratingFilter}
              onChange={(event) => {
                setRatingFilter(event.target.value as 'all' | '1' | '2' | '3' | '4' | '5');
                setCurrentPage(1);
              }}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Ratings</option>
              <option value="5">5</option>
              <option value="4">4</option>
              <option value="3">3</option>
              <option value="2">2</option>
              <option value="1">1</option>
            </select>
          </div>
          <div className="mt-3 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setAppliedSearch(searchInput.trim());
                setCurrentPage(1);
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setAppliedSearch('');
                setStatusFilter('all');
                setRatingFilter('all');
                setCurrentPage(1);
              }}
              className="bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Reset
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700 text-sm">
            {success}
          </div>
        )}

        {feedback.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-stone-600">
            No feedback found for current filters.
          </div>
        ) : (
          <div className="space-y-4">
            {feedbackPagination && (
              <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
                Showing page <span className="font-semibold">{feedbackPagination.page}</span> of{' '}
                <span className="font-semibold">{feedbackPagination.totalPages}</span> · Total filtered feedback:{' '}
                <span className="font-semibold">{feedbackPagination.totalCount}</span>
              </div>
            )}
            {feedback.map((item) => {
              const isUpdating = updatingIds.includes(item._id);

              return (
                <article key={item._id} className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 shadow-sm">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-stone-500">Feedback ID</p>
                      <p className="text-sm font-semibold text-stone-900 break-all">{item._id}</p>
                      <p className="text-sm text-stone-600 mt-1">{formatDateTime(item.createdAt)}</p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold h-fit ${
                        item.status === 'archived'
                          ? 'bg-emerald-100 text-emerald-700'
                          : item.status === 'reviewed'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2 rounded-xl border border-stone-100 bg-stone-50 p-4">
                      <p className="text-sm text-stone-700">
                        <span className="font-semibold text-stone-900">Rating:</span> {item.rating}/5
                      </p>
                      <p className="text-sm text-stone-700 mt-2 whitespace-pre-wrap break-words">{item.message}</p>
                    </div>

                    <div className="rounded-xl border border-stone-100 bg-stone-50 p-4 space-y-2">
                      <p className="text-sm text-stone-700 font-semibold">{item.name}</p>
                      <p className="text-sm text-stone-600 break-all">{item.email}</p>
                      <p className="text-sm text-stone-600">{item.phone || 'No phone provided'}</p>

                      <div className="pt-3">
                        <label className="block text-xs uppercase tracking-wide text-stone-500 mb-1">
                          Update status
                        </label>
                        <div className="flex gap-2">
                          <select
                            value={draftStatus[item._id] ?? item.status}
                            onChange={(event) =>
                              setDraftStatus((prev) => ({
                                ...prev,
                                [item._id]: event.target.value as FeedbackStatus,
                              }))
                            }
                            className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm"
                          >
                            {STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => {
                              void handleUpdateFeedback(item._id);
                            }}
                            className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg px-3 py-2 text-sm font-semibold"
                          >
                            {isUpdating ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-stone-200">
                        <label className="block text-xs uppercase tracking-wide text-stone-500 mb-1">
                          Admin Note
                        </label>
                        <textarea
                          value={draftAdminNote[item._id] ?? ''}
                          onChange={(event) =>
                            setDraftAdminNote((prev) => ({
                              ...prev,
                              [item._id]: event.target.value,
                            }))
                          }
                          className="w-full min-h-20 border border-stone-300 rounded-lg px-3 py-2 text-sm"
                          placeholder="Optional internal note"
                        />
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
            {feedbackPagination && feedbackPagination.totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
                <p className="text-sm text-stone-600">
                  Page {feedbackPagination.page} of {feedbackPagination.totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!feedbackPagination.hasPreviousPage || loading}
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    className="bg-stone-200 hover:bg-stone-300 disabled:bg-stone-100 disabled:text-stone-400 text-stone-800 rounded-lg px-4 py-2 text-sm font-semibold"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={!feedbackPagination.hasNextPage || loading}
                    onClick={() => setCurrentPage((prev) => prev + 1)}
                    className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg px-4 py-2 text-sm font-semibold"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
