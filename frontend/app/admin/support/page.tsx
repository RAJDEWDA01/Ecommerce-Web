"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buildApiUrl } from '@/lib/api';
import { clearAdminToken, getAdminToken } from '@/lib/adminAuth';

type SupportStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

interface SupportTicketNote {
  note: string;
  authorId?: string | null;
  authorEmail?: string | null;
  createdAt: string;
}

interface SupportTicket {
  _id: string;
  customer?: string | null;
  name: string;
  email: string;
  phone?: string | null;
  subject: string;
  message: string;
  status: SupportStatus;
  notes?: SupportTicketNote[];
  createdAt: string;
  updatedAt: string;
}

interface SupportTicketsResponse {
  success: boolean;
  message?: string;
  tickets?: SupportTicket[];
  pagination?: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

interface UpdateSupportStatusResponse {
  success: boolean;
  message?: string;
  ticket?: SupportTicket;
}

interface AddSupportNoteResponse {
  success: boolean;
  message?: string;
  ticket?: SupportTicket;
}

const STATUS_OPTIONS: SupportStatus[] = ['open', 'in_progress', 'resolved', 'closed'];
const SUPPORT_PAGE_LIMIT = 25;

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

export default function AdminSupportPage() {
  const router = useRouter();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [updatingTicketIds, setUpdatingTicketIds] = useState<string[]>([]);
  const [addingNoteTicketIds, setAddingNoteTicketIds] = useState<string[]>([]);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [draftStatus, setDraftStatus] = useState<Record<string, SupportStatus>>({});
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});

  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [supportPagination, setSupportPagination] = useState<{
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | SupportStatus>('all');

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

  const fetchSupportTickets = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams({
        limit: String(SUPPORT_PAGE_LIMIT),
        page: String(currentPage),
      });

      if (statusFilter !== 'all') {
        query.set('status', statusFilter);
      }

      if (appliedSearch.trim()) {
        query.set('search', appliedSearch.trim());
      }

      const response = await fetch(buildApiUrl(`/api/admin/support-tickets?${query.toString()}`), {
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

      const data = (await response.json()) as SupportTicketsResponse;

      if (!response.ok || !data.success || !data.tickets || !data.pagination) {
        throw new Error(data.message || 'Failed to fetch support tickets');
      }

      setTickets(data.tickets);
      setSupportPagination(data.pagination);
      setDraftStatus(
        data.tickets.reduce<Record<string, SupportStatus>>((acc, ticket) => {
          acc[ticket._id] = ticket.status;
          return acc;
        }, {})
      );
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load support tickets');
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, authToken, currentPage, router, statusFilter]);

  useEffect(() => {
    void fetchSupportTickets();
  }, [fetchSupportTickets]);

  const handleStatusUpdate = async (ticketId: string) => {
    if (!authToken) {
      return;
    }

    const nextStatus = draftStatus[ticketId];

    if (!nextStatus) {
      return;
    }

    try {
      setUpdatingTicketIds((prev) => [...prev, ticketId]);
      setError(null);
      setSuccess(null);

      const response = await fetch(buildApiUrl(`/api/admin/support-tickets/${ticketId}/status`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as UpdateSupportStatusResponse;

      if (!response.ok || !data.success || !data.ticket) {
        throw new Error(data.message || 'Failed to update support ticket status');
      }

      setTickets((prev) =>
        prev.map((ticket) =>
          ticket._id === ticketId ? (data.ticket as SupportTicket) : ticket
        )
      );
      setSuccess('Support ticket status updated successfully');
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Failed to update support ticket status'
      );
    } finally {
      setUpdatingTicketIds((prev) => prev.filter((id) => id !== ticketId));
    }
  };

  const handleAddNote = async (ticketId: string) => {
    if (!authToken) {
      return;
    }

    const note = (draftNotes[ticketId] ?? '').trim();

    if (!note) {
      setError('Note cannot be empty');
      return;
    }

    try {
      setAddingNoteTicketIds((prev) => [...prev, ticketId]);
      setError(null);
      setSuccess(null);

      const response = await fetch(buildApiUrl(`/api/admin/support-tickets/${ticketId}/notes`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ note }),
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as AddSupportNoteResponse;

      if (!response.ok || !data.success || !data.ticket) {
        throw new Error(data.message || 'Failed to add support note');
      }

      setTickets((prev) =>
        prev.map((ticket) =>
          ticket._id === ticketId ? (data.ticket as SupportTicket) : ticket
        )
      );
      setDraftNotes((prev) => ({ ...prev, [ticketId]: '' }));
      setSuccess('Support note added');
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Failed to add support note');
    } finally {
      setAddingNoteTicketIds((prev) => prev.filter((id) => id !== ticketId));
    }
  };

  const summary = useMemo(() => {
    const open = tickets.filter((ticket) => ticket.status === 'open').length;
    const inProgress = tickets.filter((ticket) => ticket.status === 'in_progress').length;
    const resolved = tickets.filter((ticket) => ticket.status === 'resolved').length;

    return {
      total: supportPagination?.totalCount ?? tickets.length,
      open,
      inProgress,
      resolved,
    };
  }, [supportPagination?.totalCount, tickets]);

  const handleLogout = () => {
    clearAdminToken();
    router.replace('/admin/login');
  };

  if (isAuthChecking || loading) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6 sm:py-10 lg:p-10 flex items-center justify-center">
        <p className="text-lg text-stone-700">Loading support tickets...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-stone-900">Support Triage</h1>
            <p className="text-stone-600 mt-2">Handle customer-care tickets and track resolution progress.</p>
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
          <Link href="/admin/support" className="px-3 py-2 rounded-lg text-sm font-semibold bg-amber-100 text-amber-800">
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
            <p className="text-sm text-stone-500">Total Tickets</p>
            <p className="text-3xl font-black text-stone-900 mt-1">{summary.total}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Open (Page)</p>
            <p className="text-3xl font-black text-red-700 mt-1">{summary.open}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">In Progress (Page)</p>
            <p className="text-3xl font-black text-amber-700 mt-1">{summary.inProgress}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Resolved (Page)</p>
            <p className="text-3xl font-black text-emerald-700 mt-1">{summary.resolved}</p>
          </div>
        </div>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Search by customer/email/subject"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as 'all' | SupportStatus);
                setCurrentPage(1);
              }}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Status</option>
              <option value="open">open</option>
              <option value="in_progress">in_progress</option>
              <option value="resolved">resolved</option>
              <option value="closed">closed</option>
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAppliedSearch(searchInput.trim());
                  setCurrentPage(1);
                }}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-3 py-2 text-sm font-semibold"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setAppliedSearch('');
                  setStatusFilter('all');
                  setCurrentPage(1);
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

        {success && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700 text-sm">
            {success}
          </div>
        )}

        {tickets.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-stone-600">
            No support tickets found for current filters.
          </div>
        ) : (
          <div className="space-y-4">
            {supportPagination && (
              <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
                Showing page <span className="font-semibold">{supportPagination.page}</span> of{' '}
                <span className="font-semibold">{supportPagination.totalPages}</span> · Total filtered tickets:{' '}
                <span className="font-semibold">{supportPagination.totalCount}</span>
              </div>
            )}
            {tickets.map((ticket) => {
              const isUpdating = updatingTicketIds.includes(ticket._id);
              const isAddingNote = addingNoteTicketIds.includes(ticket._id);
              const notes = ticket.notes ?? [];

              return (
                <article key={ticket._id} className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 shadow-sm">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-stone-500">Ticket ID</p>
                      <p className="text-sm font-semibold text-stone-900 break-all">{ticket._id}</p>
                      <p className="text-sm text-stone-600 mt-1">{formatDateTime(ticket.createdAt)}</p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold h-fit ${
                        ticket.status === 'resolved' || ticket.status === 'closed'
                          ? 'bg-emerald-100 text-emerald-700'
                          : ticket.status === 'in_progress'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {ticket.status}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2 rounded-xl border border-stone-100 bg-stone-50 p-4">
                      <p className="font-semibold text-stone-900">{ticket.subject}</p>
                      <p className="text-sm text-stone-700 mt-2 whitespace-pre-wrap break-words">{ticket.message}</p>
                    </div>

                    <div className="rounded-xl border border-stone-100 bg-stone-50 p-4 space-y-2">
                      <p className="text-sm text-stone-700 font-semibold">{ticket.name}</p>
                      <p className="text-sm text-stone-600 break-all">{ticket.email}</p>
                      <p className="text-sm text-stone-600">{ticket.phone || 'No phone provided'}</p>

                      <div className="pt-3">
                        <label className="block text-xs uppercase tracking-wide text-stone-500 mb-1">
                          Update status
                        </label>
                        <div className="flex gap-2">
                          <select
                            value={draftStatus[ticket._id] ?? ticket.status}
                            onChange={(event) => {
                              const nextStatus = event.target.value as SupportStatus;
                              setDraftStatus((prev) => ({ ...prev, [ticket._id]: nextStatus }));
                            }}
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
                              void handleStatusUpdate(ticket._id);
                            }}
                            className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg px-3 py-2 text-sm font-semibold"
                          >
                            {isUpdating ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-stone-200">
                        <label className="block text-xs uppercase tracking-wide text-stone-500 mb-1">
                          Internal Notes
                        </label>
                        <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                          {notes.length === 0 ? (
                            <p className="text-xs text-stone-500">No internal notes yet.</p>
                          ) : (
                            [...notes].reverse().map((note, index) => (
                              <div key={`${ticket._id}-note-${index}`} className="rounded-lg border border-stone-200 bg-white px-3 py-2">
                                <p className="text-xs text-stone-700 whitespace-pre-wrap break-words">{note.note}</p>
                                <p className="text-[11px] text-stone-500 mt-1">
                                  {note.authorEmail || 'Admin'} · {formatDateTime(note.createdAt)}
                                </p>
                              </div>
                            ))
                          )}
                        </div>
                        <textarea
                          value={draftNotes[ticket._id] ?? ''}
                          onChange={(event) =>
                            setDraftNotes((prev) => ({ ...prev, [ticket._id]: event.target.value }))
                          }
                          placeholder="Add internal note for team..."
                          className="mt-2 w-full min-h-20 border border-stone-300 rounded-lg px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          disabled={isAddingNote}
                          onClick={() => {
                            void handleAddNote(ticket._id);
                          }}
                          className="mt-2 bg-stone-800 hover:bg-black disabled:bg-stone-400 text-white rounded-lg px-3 py-2 text-sm font-semibold"
                        >
                          {isAddingNote ? 'Adding...' : 'Add Note'}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
            {supportPagination && supportPagination.totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
                <p className="text-sm text-stone-600">
                  Page {supportPagination.page} of {supportPagination.totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!supportPagination.hasPreviousPage || loading}
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    className="bg-stone-200 hover:bg-stone-300 disabled:bg-stone-100 disabled:text-stone-400 text-stone-800 rounded-lg px-4 py-2 text-sm font-semibold"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={!supportPagination.hasNextPage || loading}
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
