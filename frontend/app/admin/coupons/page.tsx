"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buildApiUrl } from '@/lib/api';
import { clearAdminToken, getAdminToken } from '@/lib/adminAuth';

type CouponDiscountType = 'percentage' | 'fixed';

interface Coupon {
  id: string;
  code: string;
  description?: string | null;
  discountType: CouponDiscountType;
  discountValue: number;
  minOrderAmount: number;
  maxDiscountAmount?: number | null;
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  usedCount: number;
  perUserLimit?: number | null;
}

interface CouponFormState {
  code: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: string;
  minOrderAmount: string;
  maxDiscountAmount: string;
  usageLimit: string;
  perUserLimit: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

interface CouponAnalytics {
  totals: { totalCoupons: number; activeCoupons: number; inactiveCoupons: number };
  usage: { totalUsedCount: number; averageUsedCount: number };
  topUsedCoupons: Array<{ id: string; code: string; usedCount: number; usageLimit?: number | null }>;
  nearingUsageLimitCoupons: Array<{
    id: string;
    code: string;
    usedCount: number;
    usageLimit?: number | null;
    usageRatio: number;
  }>;
}

const DEFAULT_FORM: CouponFormState = {
  code: '',
  description: '',
  discountType: 'percentage',
  discountValue: '',
  minOrderAmount: '0',
  maxDiscountAmount: '',
  usageLimit: '',
  perUserLimit: '',
  startsAt: '',
  endsAt: '',
  isActive: true,
};

export default function AdminCouponsPage() {
  const router = useRouter();
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [analytics, setAnalytics] = useState<CouponAnalytics | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CouponFormState>(DEFAULT_FORM);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'true' | 'false'>('all');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      router.replace('/admin/login');
      return;
    }
    setAuthToken(token);
    setCheckingAuth(false);
  }, [router]);

  const requestWithAuth = useCallback(
    async (url: string, init?: RequestInit): Promise<Response | null> => {
      if (!authToken) return null;
      const response = await fetch(buildApiUrl(url), {
        ...init,
        headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${authToken}` },
        cache: init?.cache ?? 'no-store',
      });
      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return null;
      }
      return response;
    },
    [authToken, router]
  );

  const fetchCoupons = useCallback(async () => {
    const query = new URLSearchParams({ limit: '200' });
    if (search.trim()) query.set('search', search.trim());
    if (filter !== 'all') query.set('isActive', filter);
    const response = await requestWithAuth(`/api/admin/coupons?${query.toString()}`);
    if (!response) return;
    const data = (await response.json()) as { success?: boolean; message?: string; coupons?: Coupon[] };
    if (!response.ok || !data.success || !data.coupons) throw new Error(data.message || 'Failed to fetch coupons');
    setCoupons(data.coupons);
    setSelectedIds((prev) => prev.filter((id) => data.coupons?.some((coupon) => coupon.id === id)));
  }, [filter, requestWithAuth, search]);

  const fetchAnalytics = useCallback(async () => {
    const response = await requestWithAuth('/api/admin/coupons/analytics');
    if (!response) return;
    const data = (await response.json()) as { success?: boolean; message?: string; analytics?: CouponAnalytics };
    if (!response.ok || !data.success || !data.analytics) {
      throw new Error(data.message || 'Failed to fetch coupon analytics');
    }
    setAnalytics(data.analytics);
  }, [requestWithAuth]);

  const refresh = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchCoupons(), fetchAnalytics()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load coupons');
    } finally {
      setLoading(false);
    }
  }, [authToken, fetchAnalytics, fetchCoupons]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const payload = {
        code: form.code.trim().toUpperCase(),
        description: form.description.trim(),
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        minOrderAmount: Number(form.minOrderAmount),
        maxDiscountAmount: form.maxDiscountAmount.trim() ? Number(form.maxDiscountAmount) : null,
        usageLimit: form.usageLimit.trim() ? Number(form.usageLimit) : null,
        perUserLimit: form.perUserLimit.trim() ? Number(form.perUserLimit) : null,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        isActive: form.isActive,
      };
      const response = await requestWithAuth(
        editingId ? `/api/admin/coupons/${editingId}` : '/api/admin/coupons',
        { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
      if (!response) return;
      const data = (await response.json()) as { success?: boolean; message?: string };
      if (!response.ok || !data.success) throw new Error(data.message || 'Failed to save coupon');
      setForm(DEFAULT_FORM);
      setEditingId(null);
      await refresh();
      setSuccess(editingId ? 'Coupon updated' : 'Coupon created');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save coupon');
    } finally {
      setSaving(false);
    }
  };

  const onBulkStatus = async (isActive: boolean) => {
    if (selectedIds.length === 0) return;
    try {
      setBulkLoading(true);
      setError(null);
      setSuccess(null);
      const response = await requestWithAuth('/api/admin/coupons/bulk-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds, isActive }),
      });
      if (!response) return;
      const data = (await response.json()) as { success?: boolean; message?: string; modifiedCount?: number };
      if (!response.ok || !data.success) throw new Error(data.message || 'Bulk update failed');
      setSelectedIds([]);
      await refresh();
      setSuccess(`${isActive ? 'Activated' : 'Deactivated'} ${data.modifiedCount ?? 0} coupons`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk update failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const onDelete = async (couponId: string) => {
    if (!window.confirm('Delete this coupon?')) return;
    try {
      setError(null);
      setSuccess(null);
      const response = await requestWithAuth(`/api/admin/coupons/${couponId}`, { method: 'DELETE' });
      if (!response) return;
      const data = (await response.json()) as { success?: boolean; message?: string };
      if (!response.ok || !data.success) throw new Error(data.message || 'Delete failed');
      setSelectedIds((prev) => prev.filter((id) => id !== couponId));
      await refresh();
      setSuccess('Coupon deleted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const totals = useMemo(
    () =>
      analytics?.totals ?? {
        totalCoupons: coupons.length,
        activeCoupons: coupons.filter((coupon) => coupon.isActive).length,
        inactiveCoupons: coupons.filter((coupon) => !coupon.isActive).length,
      },
    [analytics, coupons]
  );

  const allSelected = coupons.length > 0 && coupons.every((coupon) => selectedIds.includes(coupon.id));

  if (checkingAuth || loading) {
    return <main className="min-h-screen bg-stone-50 p-8">Loading coupons...</main>;
  }

  return (
    <main className="min-h-screen bg-stone-50 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-black text-stone-900">Coupon Management</h1>
          <button className="rounded bg-stone-800 px-3 py-2 text-sm font-semibold text-white" onClick={() => { clearAdminToken(); router.replace('/admin/login'); }}>
            Logout
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/admin/orders" className="rounded bg-white px-3 py-2">Orders</Link>
          <Link href="/admin/products" className="rounded bg-white px-3 py-2">Products</Link>
          <Link href="/admin/payments" className="rounded bg-white px-3 py-2">Payments</Link>
          <Link href="/admin/coupons" className="rounded bg-amber-100 px-3 py-2 font-semibold text-amber-800">Coupons</Link>
          <Link href="/admin/support" className="rounded bg-white px-3 py-2">Support</Link>
          <Link href="/admin/feedback" className="rounded bg-white px-3 py-2">Feedback</Link>
          <Link href="/admin/audit" className="rounded bg-white px-3 py-2">Audit</Link>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div className="rounded bg-white p-4"><p className="text-xs text-stone-500">Total</p><p className="text-2xl font-bold">{totals.totalCoupons}</p></div>
          <div className="rounded bg-white p-4"><p className="text-xs text-stone-500">Active</p><p className="text-2xl font-bold text-emerald-700">{totals.activeCoupons}</p></div>
          <div className="rounded bg-white p-4"><p className="text-xs text-stone-500">Inactive</p><p className="text-2xl font-bold text-red-700">{totals.inactiveCoupons}</p></div>
          <div className="rounded bg-white p-4"><p className="text-xs text-stone-500">Total Uses</p><p className="text-2xl font-bold">{analytics?.usage.totalUsedCount ?? 0}</p></div>
          <div className="rounded bg-white p-4"><p className="text-xs text-stone-500">Avg Uses</p><p className="text-2xl font-bold">{analytics?.usage.averageUsedCount ?? 0}</p></div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <section className="rounded bg-white p-4">
            <h2 className="text-sm font-bold">Top Used Coupons</h2>
            <div className="mt-2 space-y-2 text-sm">
              {(analytics?.topUsedCoupons ?? []).slice(0, 5).map((coupon) => (
                <div key={coupon.id} className="flex justify-between rounded bg-stone-50 p-2">
                  <span className="font-semibold">{coupon.code}</span>
                  <span>{coupon.usedCount} / {coupon.usageLimit ?? 'Unlimited'}</span>
                </div>
              ))}
              {(analytics?.topUsedCoupons?.length ?? 0) === 0 && <p className="text-stone-500">No usage data yet.</p>}
            </div>
          </section>
          <section className="rounded bg-white p-4">
            <h2 className="text-sm font-bold">Nearing Usage Limit</h2>
            <div className="mt-2 space-y-2 text-sm">
              {(analytics?.nearingUsageLimitCoupons ?? []).slice(0, 10).map((coupon) => (
                <div key={coupon.id} className="rounded bg-stone-50 p-2">
                  <p className="font-semibold">{coupon.code}</p>
                  <p>{coupon.usedCount} / {coupon.usageLimit ?? 'N/A'} ({coupon.usageRatio}%)</p>
                </div>
              ))}
              {(analytics?.nearingUsageLimitCoupons?.length ?? 0) === 0 && <p className="text-stone-500">Nothing near the limit.</p>}
            </div>
          </section>
        </div>

        <section className="grid gap-2 rounded bg-white p-4 md:grid-cols-3">
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="rounded border px-3 py-2" placeholder="Search code/description" />
          <select value={filter} onChange={(event) => setFilter(event.target.value as 'all' | 'true' | 'false')} className="rounded border px-3 py-2">
            <option value="all">All</option><option value="true">Active</option><option value="false">Inactive</option>
          </select>
          <button className="rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => { void refresh(); }}>Apply Filters</button>
        </section>

        <section className="rounded bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{editingId ? 'Edit Coupon' : 'Create Coupon'}</h2>
            {editingId && <button className="text-sm text-stone-600 underline" onClick={() => { setEditingId(null); setForm(DEFAULT_FORM); }}>Cancel Edit</button>}
          </div>
          <form className="grid gap-2 md:grid-cols-3" onSubmit={onSave}>
            <input required value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="Code" className="rounded border px-3 py-2" />
            <select value={form.discountType} onChange={(event) => setForm((prev) => ({ ...prev, discountType: event.target.value as CouponDiscountType }))} className="rounded border px-3 py-2">
              <option value="percentage">percentage</option><option value="fixed">fixed</option>
            </select>
            <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))} />Active</label>
            <input required type="number" min="0" step="0.01" value={form.discountValue} onChange={(event) => setForm((prev) => ({ ...prev, discountValue: event.target.value }))} placeholder="Discount Value" className="rounded border px-3 py-2" />
            <input required type="number" min="0" step="0.01" value={form.minOrderAmount} onChange={(event) => setForm((prev) => ({ ...prev, minOrderAmount: event.target.value }))} placeholder="Min Order Amount" className="rounded border px-3 py-2" />
            <input type="number" min="0" step="0.01" value={form.maxDiscountAmount} onChange={(event) => setForm((prev) => ({ ...prev, maxDiscountAmount: event.target.value }))} placeholder="Max Discount" className="rounded border px-3 py-2" />
            <input type="number" min="1" step="1" value={form.usageLimit} onChange={(event) => setForm((prev) => ({ ...prev, usageLimit: event.target.value }))} placeholder="Usage Limit" className="rounded border px-3 py-2" />
            <input type="number" min="1" step="1" value={form.perUserLimit} onChange={(event) => setForm((prev) => ({ ...prev, perUserLimit: event.target.value }))} placeholder="Per User Limit" className="rounded border px-3 py-2" />
            <input type="datetime-local" value={form.startsAt} onChange={(event) => setForm((prev) => ({ ...prev, startsAt: event.target.value }))} className="rounded border px-3 py-2" />
            <input type="datetime-local" value={form.endsAt} onChange={(event) => setForm((prev) => ({ ...prev, endsAt: event.target.value }))} className="rounded border px-3 py-2" />
            <textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="Description" className="rounded border px-3 py-2 md:col-span-3 min-h-16" />
            <button disabled={saving} className="rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white">{saving ? 'Saving...' : 'Save Coupon'}</button>
          </form>
        </section>

        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>}

        <section className="rounded bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? coupons.map((coupon) => coupon.id) : [])} />
              Select all
            </label>
            <button disabled={bulkLoading || selectedIds.length === 0} onClick={() => { void onBulkStatus(true); }} className="rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-emerald-300">Activate Selected</button>
            <button disabled={bulkLoading || selectedIds.length === 0} onClick={() => { void onBulkStatus(false); }} className="rounded bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-red-300">Deactivate Selected</button>
            <span className="text-xs text-stone-600">{selectedIds.length} selected</span>
          </div>
          <div className="space-y-2">
            {coupons.map((coupon) => (
              <article key={coupon.id} className="rounded border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(coupon.id)}
                      onChange={(event) =>
                        setSelectedIds((prev) => event.target.checked ? [...prev, coupon.id] : prev.filter((id) => id !== coupon.id))
                      }
                    />
                    {coupon.code}
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={coupon.isActive ? 'rounded bg-emerald-100 px-2 py-1 text-emerald-700' : 'rounded bg-red-100 px-2 py-1 text-red-700'}>
                      {coupon.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      className="rounded bg-blue-600 px-2 py-1 font-semibold text-white"
                      onClick={() => {
                        setEditingId(coupon.id);
                        setForm({
                          code: coupon.code,
                          description: coupon.description ?? '',
                          discountType: coupon.discountType,
                          discountValue: String(coupon.discountValue),
                          minOrderAmount: String(coupon.minOrderAmount),
                          maxDiscountAmount:
                            coupon.maxDiscountAmount === null || coupon.maxDiscountAmount === undefined
                              ? ''
                              : String(coupon.maxDiscountAmount),
                          usageLimit: coupon.usageLimit ? String(coupon.usageLimit) : '',
                          perUserLimit: coupon.perUserLimit ? String(coupon.perUserLimit) : '',
                          startsAt: coupon.startsAt ? new Date(coupon.startsAt).toISOString().slice(0, 16) : '',
                          endsAt: coupon.endsAt ? new Date(coupon.endsAt).toISOString().slice(0, 16) : '',
                          isActive: coupon.isActive,
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded bg-red-600 px-2 py-1 font-semibold text-white"
                      onClick={() => {
                        void onDelete(coupon.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-sm text-stone-600">
                  {coupon.discountType === 'percentage' ? `${coupon.discountValue}% off` : `Rs ${coupon.discountValue} off`} | Used {coupon.usedCount} / {coupon.usageLimit ?? 'Unlimited'}
                </p>
              </article>
            ))}
            {coupons.length === 0 && <p className="text-sm text-stone-500">No coupons found.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
