"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buildApiUrl } from '@/lib/api';
import { clearAdminToken, getAdminToken } from '@/lib/adminAuth';

type OrderStatus = 'placed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
type PaymentStatus = 'pending' | 'paid' | 'failed';
type RefundStatus = 'not_required' | 'pending' | 'processed' | 'failed';
type RefundSettlementStatus = 'unknown' | 'pending' | 'settled' | 'failed';

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
  shippingInfo: ShippingInfo;
  items: OrderItem[];
  totalAmount: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  fulfillmentInfo?: FulfillmentInfo;
  refundInfo?: {
    status: RefundStatus;
    amount: number;
    currency: 'INR';
    initiatedAt?: string | null;
    processedAt?: string | null;
    reference?: string | null;
    note?: string | null;
    gatewayRefundId?: string | null;
    gatewaySettlementStatus?: RefundSettlementStatus;
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
}

interface OrdersApiResponse {
  success: boolean;
  message?: string;
  orders?: Order[];
  totalCount?: number;
  pagination?: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

interface RefundAnalyticsResponse {
  success: boolean;
  message?: string;
  analytics?: {
    totals: {
      totalOrders: number;
      refundableOrders: number;
      totalTrackedAmount: number;
      processedRate: number;
    };
    statusBreakdown: {
      notRequiredCount: number;
      pendingCount: number;
      processedCount: number;
      failedCount: number;
    };
    amountBreakdown: {
      pendingAmount: number;
      processedAmount: number;
      failedAmount: number;
    };
    settlementBreakdown: {
      unknownCount: number;
      pendingCount: number;
      settledCount: number;
      failedCount: number;
    };
  };
}

interface UpdateStatusApiResponse {
  success: boolean;
  message: string;
  orderStatus?: OrderStatus;
  fulfillmentInfo?: FulfillmentInfo;
  refundInfo?: Order['refundInfo'];
}

interface ReviewCancellationApiResponse {
  success: boolean;
  message?: string;
  orderStatus?: OrderStatus;
  cancellationRequest?: Order['cancellationRequest'];
  refundInfo?: Order['refundInfo'];
}

interface UpdateRefundApiResponse {
  success: boolean;
  message?: string;
  refundInfo?: Order['refundInfo'];
}

interface LowStockProduct {
  _id: string;
  name: string;
  sku: string;
  size: string;
  stockQuantity: number;
  updatedAt: string;
}

interface LowStockApiResponse {
  success: boolean;
  message?: string;
  threshold?: number;
  totalLowStock?: number;
  outOfStockCount?: number;
  products?: LowStockProduct[];
}

interface LowStockSummary {
  threshold: number;
  totalLowStock: number;
  outOfStockCount: number;
  products: LowStockProduct[];
}

const STATUS_OPTIONS: OrderStatus[] = ['placed', 'processing', 'shipped', 'delivered', 'cancelled'];
const ORDERS_PAGE_LIMIT = 25;

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

const toDateTimeInput = (iso: string | null | undefined): string => {
  if (!iso) {
    return '';
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
};

const buildRefundExportQuery = (input: {
  appliedSearch: string;
  orderStatusFilter: 'all' | OrderStatus;
  paymentStatusFilter: 'all' | PaymentStatus;
  refundStatusFilter: 'all' | RefundStatus;
  appliedRefundReference: string;
  refundFromDate: string;
  refundToDate: string;
  limit: string;
}): URLSearchParams => {
  const query = new URLSearchParams({ limit: input.limit });

  if (input.appliedSearch.trim()) {
    query.set('search', input.appliedSearch.trim());
  }

  if (input.orderStatusFilter !== 'all') {
    query.set('orderStatus', input.orderStatusFilter);
  }

  if (input.paymentStatusFilter !== 'all') {
    query.set('paymentStatus', input.paymentStatusFilter);
  }

  if (input.refundStatusFilter !== 'all') {
    query.set('refundStatus', input.refundStatusFilter);
  }

  if (input.appliedRefundReference.trim()) {
    query.set('refundReference', input.appliedRefundReference.trim());
  }

  if (input.refundFromDate) {
    query.set('refundFromDate', input.refundFromDate);
  }

  if (input.refundToDate) {
    query.set('refundToDate', input.refundToDate);
  }

  return query;
};

export default function AdminOrdersPage() {
  const router = useRouter();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [refundAnalytics, setRefundAnalytics] = useState<RefundAnalyticsResponse['analytics'] | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [ordersPagination, setOrdersPagination] = useState<{
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  } | null>(null);
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | OrderStatus>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | PaymentStatus>('all');
  const [refundStatusFilter, setRefundStatusFilter] = useState<'all' | RefundStatus>('all');
  const [refundReferenceInput, setRefundReferenceInput] = useState('');
  const [appliedRefundReference, setAppliedRefundReference] = useState('');
  const [refundFromDate, setRefundFromDate] = useState('');
  const [refundToDate, setRefundToDate] = useState('');
  const [draftStatus, setDraftStatus] = useState<Record<string, OrderStatus>>({});
  const [fulfillmentCourierDraft, setFulfillmentCourierDraft] = useState<Record<string, string>>({});
  const [fulfillmentTrackingNumberDraft, setFulfillmentTrackingNumberDraft] = useState<Record<string, string>>({});
  const [fulfillmentTrackingUrlDraft, setFulfillmentTrackingUrlDraft] = useState<Record<string, string>>({});
  const [cancellationNotes, setCancellationNotes] = useState<Record<string, string>>({});
  const [refundDraftStatus, setRefundDraftStatus] = useState<Record<string, 'pending' | 'processed' | 'failed'>>({});
  const [refundDraftAmount, setRefundDraftAmount] = useState<Record<string, string>>({});
  const [refundDraftReference, setRefundDraftReference] = useState<Record<string, string>>({});
  const [refundDraftNote, setRefundDraftNote] = useState<Record<string, string>>({});
  const [refundDraftGatewayRefundId, setRefundDraftGatewayRefundId] = useState<Record<string, string>>({});
  const [refundDraftGatewaySettlementStatus, setRefundDraftGatewaySettlementStatus] = useState<
    Record<string, RefundSettlementStatus>
  >({});
  const [refundDraftGatewaySettlementAt, setRefundDraftGatewaySettlementAt] = useState<Record<string, string>>({});
  const [updatingOrderIds, setUpdatingOrderIds] = useState<string[]>([]);
  const [reviewingCancellationOrderIds, setReviewingCancellationOrderIds] = useState<string[]>([]);
  const [updatingRefundOrderIds, setUpdatingRefundOrderIds] = useState<string[]>([]);
  const [lowStockThreshold, setLowStockThreshold] = useState(10);
  const [lowStockSummary, setLowStockSummary] = useState<LowStockSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const totalOrders = ordersPagination?.totalCount ?? orders.length;
    const paidOrders = orders.filter((order) => order.paymentStatus === 'paid').length;
    const pendingOrders = orders.filter((order) => order.paymentStatus === 'pending').length;

    return { totalOrders, paidOrders, pendingOrders };
  }, [orders, ordersPagination?.totalCount]);

  const settlementBreakdownRows = useMemo(() => {
    if (!refundAnalytics) {
      return [];
    }

    const entries = [
      {
        key: 'unknown',
        label: 'Unknown',
        count: refundAnalytics.settlementBreakdown.unknownCount,
        cardClassName: 'border-stone-200 bg-stone-50',
        countClassName: 'text-stone-900',
        barClassName: 'bg-stone-500',
      },
      {
        key: 'pending',
        label: 'Pending',
        count: refundAnalytics.settlementBreakdown.pendingCount,
        cardClassName: 'border-amber-200 bg-amber-50',
        countClassName: 'text-amber-900',
        barClassName: 'bg-amber-500',
      },
      {
        key: 'settled',
        label: 'Settled',
        count: refundAnalytics.settlementBreakdown.settledCount,
        cardClassName: 'border-emerald-200 bg-emerald-50',
        countClassName: 'text-emerald-900',
        barClassName: 'bg-emerald-500',
      },
      {
        key: 'failed',
        label: 'Failed',
        count: refundAnalytics.settlementBreakdown.failedCount,
        cardClassName: 'border-red-200 bg-red-50',
        countClassName: 'text-red-900',
        barClassName: 'bg-red-500',
      },
    ] as const;

    const total = entries.reduce((sum, entry) => sum + entry.count, 0);

    return entries.map((entry) => ({
      ...entry,
      percentage: total > 0 ? Math.round((entry.count / total) * 10000) / 100 : 0,
    }));
  }, [refundAnalytics]);

  const settlementCoverageRate = useMemo(() => {
    if (!refundAnalytics || refundAnalytics.totals.refundableOrders === 0) {
      return 0;
    }

    return (
      Math.round(
        (refundAnalytics.settlementBreakdown.settledCount / refundAnalytics.totals.refundableOrders) *
          10000
      ) / 100
    );
  }, [refundAnalytics]);

  useEffect(() => {
    const token = getAdminToken();

    if (!token) {
      router.replace('/admin/login');
      return;
    }

    setAuthToken(token);
    setIsAuthChecking(false);
  }, [router]);

  useEffect(() => {
    const fetchOrders = async () => {
      if (!authToken) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams({
          limit: String(ORDERS_PAGE_LIMIT),
          page: String(currentPage),
        });

        if (appliedSearch.trim()) {
          query.set('search', appliedSearch.trim());
        }

        if (orderStatusFilter !== 'all') {
          query.set('orderStatus', orderStatusFilter);
        }

        if (paymentStatusFilter !== 'all') {
          query.set('paymentStatus', paymentStatusFilter);
        }

        if (refundStatusFilter !== 'all') {
          query.set('refundStatus', refundStatusFilter);
        }

        if (appliedRefundReference.trim()) {
          query.set('refundReference', appliedRefundReference.trim());
        }

        if (refundFromDate) {
          query.set('refundFromDate', refundFromDate);
        }

        if (refundToDate) {
          query.set('refundToDate', refundToDate);
        }

        const analyticsQuery = new URLSearchParams(query);
        analyticsQuery.delete('limit');
        analyticsQuery.delete('page');

        const [ordersResponse, analyticsResponse] = await Promise.all([
          fetch(buildApiUrl(`/api/orders?${query.toString()}`), {
            cache: 'no-store',
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          }),
          fetch(buildApiUrl(`/api/orders/refunds/analytics?${analyticsQuery.toString()}`), {
            cache: 'no-store',
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          }),
        ]);

        if (
          ordersResponse.status === 401 ||
          ordersResponse.status === 403 ||
          analyticsResponse.status === 401 ||
          analyticsResponse.status === 403
        ) {
          clearAdminToken();
          router.replace('/admin/login');
          return;
        }

        const [data, analyticsData] = (await Promise.all([
          ordersResponse.json(),
          analyticsResponse.json(),
        ])) as [OrdersApiResponse, RefundAnalyticsResponse];

        if (!ordersResponse.ok || !data.success || !data.orders || !data.pagination) {
          throw new Error(data.message || 'Failed to fetch orders');
        }

        if (!analyticsResponse.ok || !analyticsData.success || !analyticsData.analytics) {
          throw new Error(analyticsData.message || 'Failed to fetch refund analytics');
        }

        let nextLowStockSummary: LowStockSummary | null = null;
        try {
          const lowStockResponse = await fetch(
            buildApiUrl(`/api/admin/inventory/low-stock?threshold=${lowStockThreshold}&limit=8`),
            {
              cache: 'no-store',
              headers: {
                Authorization: `Bearer ${authToken}`,
              },
            }
          );

          if (lowStockResponse.status === 401 || lowStockResponse.status === 403) {
            clearAdminToken();
            router.replace('/admin/login');
            return;
          }

          const lowStockData = (await lowStockResponse.json()) as LowStockApiResponse;

          if (
            lowStockResponse.ok &&
            lowStockData.success &&
            typeof lowStockData.threshold === 'number' &&
            typeof lowStockData.totalLowStock === 'number' &&
            typeof lowStockData.outOfStockCount === 'number' &&
            Array.isArray(lowStockData.products)
          ) {
            nextLowStockSummary = {
              threshold: lowStockData.threshold,
              totalLowStock: lowStockData.totalLowStock,
              outOfStockCount: lowStockData.outOfStockCount,
              products: lowStockData.products,
            };
          }
        } catch {
          nextLowStockSummary = null;
        }

        setOrders(data.orders);
        setOrdersPagination(data.pagination);
        setRefundAnalytics(analyticsData.analytics);
        setLowStockSummary(nextLowStockSummary);
        setDraftStatus(
          data.orders.reduce<Record<string, OrderStatus>>((acc, order) => {
            acc[order._id] = order.orderStatus;
            return acc;
          }, {})
        );
        setFulfillmentCourierDraft(
          data.orders.reduce<Record<string, string>>((acc, order) => {
            acc[order._id] = order.fulfillmentInfo?.courierName ?? '';
            return acc;
          }, {})
        );
        setFulfillmentTrackingNumberDraft(
          data.orders.reduce<Record<string, string>>((acc, order) => {
            acc[order._id] = order.fulfillmentInfo?.trackingNumber ?? '';
            return acc;
          }, {})
        );
        setFulfillmentTrackingUrlDraft(
          data.orders.reduce<Record<string, string>>((acc, order) => {
            acc[order._id] = order.fulfillmentInfo?.trackingUrl ?? '';
            return acc;
          }, {})
        );
        setRefundDraftStatus(
          data.orders.reduce<Record<string, 'pending' | 'processed' | 'failed'>>((acc, order) => {
            acc[order._id] =
              order.refundInfo?.status === 'processed' || order.refundInfo?.status === 'failed'
                ? order.refundInfo.status
                : 'pending';
            return acc;
          }, {})
        );
        setRefundDraftAmount(
          data.orders.reduce<Record<string, string>>((acc, order) => {
            acc[order._id] = String(order.refundInfo?.amount ?? order.totalAmount);
            return acc;
          }, {})
        );
        setRefundDraftReference(
          data.orders.reduce<Record<string, string>>((acc, order) => {
            acc[order._id] = order.refundInfo?.reference ?? '';
            return acc;
          }, {})
        );
        setRefundDraftNote(
          data.orders.reduce<Record<string, string>>((acc, order) => {
            acc[order._id] = order.refundInfo?.note ?? '';
            return acc;
          }, {})
        );
        setRefundDraftGatewayRefundId(
          data.orders.reduce<Record<string, string>>((acc, order) => {
            acc[order._id] = order.refundInfo?.gatewayRefundId ?? '';
            return acc;
          }, {})
        );
        setRefundDraftGatewaySettlementStatus(
          data.orders.reduce<Record<string, RefundSettlementStatus>>((acc, order) => {
            acc[order._id] = order.refundInfo?.gatewaySettlementStatus ?? 'unknown';
            return acc;
          }, {})
        );
        setRefundDraftGatewaySettlementAt(
          data.orders.reduce<Record<string, string>>((acc, order) => {
            acc[order._id] = toDateTimeInput(order.refundInfo?.gatewaySettlementAt);
            return acc;
          }, {})
        );
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load orders');
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, [
    appliedRefundReference,
    appliedSearch,
    authToken,
    currentPage,
    orderStatusFilter,
    paymentStatusFilter,
    refundFromDate,
    refundStatusFilter,
    refundToDate,
    lowStockThreshold,
    router,
  ]);

  const handleStatusUpdate = async (orderId: string) => {
    if (!authToken) {
      return;
    }

    const nextStatus = draftStatus[orderId];

    if (!nextStatus) {
      return;
    }

    try {
      setUpdatingOrderIds((prev) => [...prev, orderId]);
      setError(null);

      const response = await fetch(buildApiUrl(`/api/orders/${orderId}/status`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          orderStatus: nextStatus,
          fulfillment: {
            courierName: fulfillmentCourierDraft[orderId] || null,
            trackingNumber: fulfillmentTrackingNumberDraft[orderId] || null,
            trackingUrl: fulfillmentTrackingUrlDraft[orderId] || null,
          },
        }),
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as UpdateStatusApiResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to update order status');
      }

      setOrders((prev) =>
        prev.map((order) =>
          order._id === orderId
            ? {
                ...order,
                orderStatus: data.orderStatus ?? nextStatus,
                fulfillmentInfo: data.fulfillmentInfo ?? order.fulfillmentInfo,
                refundInfo: data.refundInfo ?? order.refundInfo,
              }
            : order
        )
      );

      if (data.fulfillmentInfo) {
        setFulfillmentCourierDraft((prev) => ({
          ...prev,
          [orderId]: data.fulfillmentInfo?.courierName ?? '',
        }));
        setFulfillmentTrackingNumberDraft((prev) => ({
          ...prev,
          [orderId]: data.fulfillmentInfo?.trackingNumber ?? '',
        }));
        setFulfillmentTrackingUrlDraft((prev) => ({
          ...prev,
          [orderId]: data.fulfillmentInfo?.trackingUrl ?? '',
        }));
      }
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update order status');
    } finally {
      setUpdatingOrderIds((prev) => prev.filter((id) => id !== orderId));
    }
  };

  const handleCancellationReview = async (orderId: string, action: 'approve' | 'reject') => {
    if (!authToken) {
      return;
    }

    try {
      setReviewingCancellationOrderIds((prev) => [...prev, orderId]);
      setError(null);

      const response = await fetch(buildApiUrl(`/api/orders/${orderId}/cancellation-request/decision`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          action,
          note: cancellationNotes[orderId] || null,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as ReviewCancellationApiResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to review cancellation request');
      }

      setOrders((prev) =>
        prev.map((order) =>
          order._id === orderId
            ? {
                ...order,
                orderStatus: data.orderStatus ?? order.orderStatus,
                cancellationRequest: data.cancellationRequest ?? order.cancellationRequest,
                refundInfo: data.refundInfo ?? order.refundInfo,
              }
            : order
        )
      );
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : 'Failed to review cancellation request'
      );
    } finally {
      setReviewingCancellationOrderIds((prev) => prev.filter((id) => id !== orderId));
    }
  };

  const handleRefundUpdate = async (orderId: string) => {
    if (!authToken) {
      return;
    }

    try {
      setUpdatingRefundOrderIds((prev) => [...prev, orderId]);
      setError(null);

      const response = await fetch(buildApiUrl(`/api/orders/${orderId}/refund`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          status: refundDraftStatus[orderId] ?? 'pending',
          amount: Number(refundDraftAmount[orderId]),
          reference: refundDraftReference[orderId] || null,
          note: refundDraftNote[orderId] || null,
          gatewayRefundId: refundDraftGatewayRefundId[orderId] || null,
          gatewaySettlementStatus: refundDraftGatewaySettlementStatus[orderId] ?? 'unknown',
          gatewaySettlementAt: refundDraftGatewaySettlementAt[orderId]
            ? new Date(refundDraftGatewaySettlementAt[orderId]).toISOString()
            : null,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as UpdateRefundApiResponse;

      if (!response.ok || !data.success || !data.refundInfo) {
        throw new Error(data.message || 'Failed to update refund');
      }

      const nextRefundInfo = data.refundInfo;

      setOrders((prev) =>
        prev.map((order) =>
          order._id === orderId
            ? {
                ...order,
                refundInfo: nextRefundInfo,
              }
            : order
        )
      );
      setRefundDraftGatewaySettlementAt((prev) => ({
        ...prev,
        [orderId]: toDateTimeInput(nextRefundInfo.gatewaySettlementAt),
      }));
    } catch (refundError) {
      setError(refundError instanceof Error ? refundError.message : 'Failed to update refund');
    } finally {
      setUpdatingRefundOrderIds((prev) => prev.filter((id) => id !== orderId));
    }
  };

  const handleExportRefundsCsv = async () => {
    if (!authToken) {
      return;
    }

    try {
      setError(null);
      const query = buildRefundExportQuery({
        appliedSearch,
        orderStatusFilter,
        paymentStatusFilter,
        refundStatusFilter,
        appliedRefundReference,
        refundFromDate,
        refundToDate,
        limit: '5000',
      });

      const response = await fetch(buildApiUrl(`/api/orders/refunds/export?${query.toString()}`), {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message || 'Failed to export refunds CSV');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename=\"([^\"]+)\"/i);
      anchor.href = downloadUrl;
      anchor.download = filenameMatch?.[1] || 'refunds.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export refunds CSV');
    }
  };

  const handleExportRefundTrendCsv = async () => {
    if (!authToken) {
      return;
    }

    try {
      setError(null);
      const query = buildRefundExportQuery({
        appliedSearch,
        orderStatusFilter,
        paymentStatusFilter,
        refundStatusFilter,
        appliedRefundReference,
        refundFromDate,
        refundToDate,
        limit: '5000',
      });

      const response = await fetch(
        buildApiUrl(`/api/orders/refunds/analytics/export?${query.toString()}`),
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      );

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message || 'Failed to export refund trend CSV');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename=\"([^\"]+)\"/i);
      anchor.href = downloadUrl;
      anchor.download = filenameMatch?.[1] || 'refund-trend.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export refund trend CSV');
    }
  };

  const handleLogout = () => {
    clearAdminToken();
    router.replace('/admin/login');
  };

  if (isAuthChecking || loading) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6 sm:py-10 lg:p-10 flex items-center justify-center">
        <p className="text-lg text-stone-700">Loading orders...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-stone-900">Order Management</h1>
            <p className="text-stone-600 mt-2">Track orders, payment status, and fulfillment progress.</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="self-start md:self-auto bg-stone-800 hover:bg-black text-white px-4 py-2 rounded-lg text-sm font-semibold"
          >
            Logout
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-3 mb-8">
          <Link href="/admin/orders" className="px-3 py-2 rounded-lg text-sm font-semibold bg-amber-100 text-amber-800">
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
          <Link href="/admin/feedback" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Feedback
          </Link>
          <Link href="/admin/audit" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Audit
          </Link>
        </div>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search order/customer/email/phone"
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={orderStatusFilter}
              onChange={(event) => {
                setOrderStatusFilter(event.target.value as 'all' | OrderStatus);
                setCurrentPage(1);
              }}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Order Status</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              value={paymentStatusFilter}
              onChange={(event) => {
                setPaymentStatusFilter(event.target.value as 'all' | PaymentStatus);
                setCurrentPage(1);
              }}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Payment Status</option>
              <option value="pending">pending</option>
              <option value="paid">paid</option>
              <option value="failed">failed</option>
            </select>
            <select
              value={refundStatusFilter}
              onChange={(event) => {
                setRefundStatusFilter(event.target.value as 'all' | RefundStatus);
                setCurrentPage(1);
              }}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Refund Status</option>
              <option value="not_required">not_required</option>
              <option value="pending">pending</option>
              <option value="processed">processed</option>
              <option value="failed">failed</option>
            </select>
            <input
              type="text"
              value={refundReferenceInput}
              onChange={(event) => setRefundReferenceInput(event.target.value)}
              placeholder="Refund reference contains..."
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={refundFromDate}
              onChange={(event) => {
                setRefundFromDate(event.target.value);
                setCurrentPage(1);
              }}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={refundToDate}
              onChange={(event) => {
                setRefundToDate(event.target.value);
                setCurrentPage(1);
              }}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAppliedSearch(searchInput.trim());
                  setAppliedRefundReference(refundReferenceInput.trim());
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
                  setOrderStatusFilter('all');
                  setPaymentStatusFilter('all');
                  setRefundStatusFilter('all');
                  setRefundReferenceInput('');
                  setAppliedRefundReference('');
                  setRefundFromDate('');
                  setRefundToDate('');
                  setCurrentPage(1);
                }}
                className="flex-1 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-lg px-3 py-2 text-sm font-semibold"
              >
                Reset
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="low-stock-threshold" className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                Low-stock alert
              </label>
              <select
                id="low-stock-threshold"
                value={String(lowStockThreshold)}
                onChange={(event) => setLowStockThreshold(Number(event.target.value))}
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="5">5 units</option>
                <option value="10">10 units</option>
                <option value="20">20 units</option>
                <option value="50">50 units</option>
              </select>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleExportRefundsCsv();
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold"
              >
                Export Refunds CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleExportRefundTrendCsv();
                }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-semibold"
              >
                Export Refund Trend CSV
              </button>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Total Orders</p>
            <p className="text-3xl font-black text-stone-900 mt-1">{totals.totalOrders}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Paid Orders (Page)</p>
            <p className="text-3xl font-black text-emerald-700 mt-1">{totals.paidOrders}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Pending Payment (Page)</p>
            <p className="text-3xl font-black text-amber-700 mt-1">{totals.pendingOrders}</p>
          </div>
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="text-sm text-red-700">Low Stock (≤ {lowStockSummary?.threshold ?? lowStockThreshold})</p>
            <p className="text-3xl font-black text-red-900 mt-1">
              {lowStockSummary ? lowStockSummary.totalLowStock : '-'}
            </p>
            <p className="text-xs text-red-700 mt-1">
              Out of stock: {lowStockSummary ? lowStockSummary.outOfStockCount : '-'}
            </p>
          </div>
        </div>

        {lowStockSummary && lowStockSummary.totalLowStock > 0 && (
          <section className="mb-8 rounded-2xl border border-red-200 bg-red-50 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-red-900">Low-Stock Alerts</h2>
                <p className="text-sm text-red-800">
                  {lowStockSummary.totalLowStock} products are at or below {lowStockSummary.threshold} units.
                </p>
              </div>
              <Link
                href="/admin/products"
                className="rounded-lg bg-red-700 hover:bg-red-800 text-white px-4 py-2 text-sm font-semibold"
              >
                Manage Inventory
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {lowStockSummary.products.map((item) => (
                <div key={item._id} className="rounded-xl border border-red-100 bg-white px-4 py-3">
                  <p className="text-sm font-semibold text-stone-900">{item.name}</p>
                  <p className="text-xs text-stone-600 mt-1">SKU: {item.sku}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-stone-600">Size: {item.size}</span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        item.stockQuantity <= 0
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {item.stockQuantity <= 0 ? 'Out of stock' : `${item.stockQuantity} left`}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-stone-500">Updated: {formatDateTime(item.updatedAt)}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {refundAnalytics && (
          <div className="mb-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
                <p className="text-sm text-blue-700">Refundable Orders</p>
                <p className="text-3xl font-black text-blue-900 mt-1">
                  {refundAnalytics.totals.refundableOrders}
                </p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="text-sm text-amber-700">Pending Refund Amount</p>
                <p className="text-2xl font-black text-amber-900 mt-1">
                  {formatCurrency(refundAnalytics.amountBreakdown.pendingAmount)}
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-sm text-emerald-700">Processed Refund Amount</p>
                <p className="text-2xl font-black text-emerald-900 mt-1">
                  {formatCurrency(refundAnalytics.amountBreakdown.processedAmount)}
                </p>
              </div>
              <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
                <p className="text-sm text-red-700">Failed Refund Count</p>
                <p className="text-3xl font-black text-red-900 mt-1">
                  {refundAnalytics.statusBreakdown.failedCount}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white p-5">
                <p className="text-sm text-stone-500">Refund Processed Rate</p>
                <p className="text-3xl font-black text-stone-900 mt-1">
                  {refundAnalytics.totals.processedRate}%
                </p>
              </div>
            </div>

            <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-stone-900">Settlement Overview</h2>
                  <p className="text-sm text-stone-600">
                    Gateway settlement signals for refundable orders.
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-emerald-700">Settlement Coverage</p>
                  <p className="text-lg font-black text-emerald-900">{settlementCoverageRate}%</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
                {settlementBreakdownRows.map((entry) => (
                  <div key={entry.key} className={`rounded-xl border p-4 ${entry.cardClassName}`}>
                    <p className="text-xs uppercase tracking-wide text-stone-600">{entry.label}</p>
                    <p className={`mt-1 text-2xl font-black ${entry.countClassName}`}>{entry.count}</p>
                    <p className="text-xs text-stone-600 mt-1">{entry.percentage}% of tracked refunds</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-stone-100 bg-stone-50 p-4">
                <h3 className="text-sm font-semibold text-stone-800">Settlement Distribution</h3>
                <div className="mt-3 space-y-2">
                  {settlementBreakdownRows.map((entry) => (
                    <div key={`${entry.key}-bar`}>
                      <div className="flex items-center justify-between text-xs text-stone-600 mb-1">
                        <span>{entry.label}</span>
                        <span>
                          {entry.count} ({entry.percentage}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${entry.barClassName}`}
                          style={{
                            width: `${entry.count === 0 ? 0 : Math.max(6, Math.round(entry.percentage))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {orders.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-6 sm:p-10 text-center text-stone-600">
            No orders found yet.
          </div>
        ) : (
          <div className="space-y-4">
            {ordersPagination && (
              <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
                Showing page <span className="font-semibold">{ordersPagination.page}</span> of{' '}
                <span className="font-semibold">{ordersPagination.totalPages}</span> · Total filtered orders:{' '}
                <span className="font-semibold">{ordersPagination.totalCount}</span>
              </div>
            )}
            {orders.map((order) => {
              const isUpdating = updatingOrderIds.includes(order._id);
              const isReviewingCancellation = reviewingCancellationOrderIds.includes(order._id);
              const cancellation = order.cancellationRequest;

              return (
                <article key={order._id} className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-6 shadow-sm">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-stone-500">Order ID</p>
                      <p className="text-lg font-bold text-stone-900 break-all">{order._id}</p>
                      <p className="text-sm text-stone-500 mt-1">{formatDateTime(order.createdAt)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="px-3 py-1 rounded-full bg-stone-100 text-stone-700 text-sm font-semibold capitalize">
                        {order.orderStatus}
                      </span>
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-semibold capitalize ${
                          order.paymentStatus === 'paid'
                            ? 'bg-emerald-100 text-emerald-700'
                            : order.paymentStatus === 'failed'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {order.paymentStatus}
                      </span>
                      {cancellation?.status && cancellation.status !== 'none' && (
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-semibold capitalize ${
                            cancellation.status === 'requested'
                              ? 'bg-amber-100 text-amber-700'
                              : cancellation.status === 'approved'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-red-100 text-red-700'
                          }`}
                        >
                          cancellation {cancellation.status}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2 rounded-xl border border-stone-100 bg-stone-50 p-4">
                      <p className="font-semibold text-stone-800 mb-2">Items</p>
                      <ul className="space-y-2">
                        {order.items.map((item) => (
                          <li key={`${order._id}-${item.sku}`} className="flex flex-col sm:flex-row sm:justify-between gap-1 text-sm text-stone-700">
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
                    </div>

                    <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                      <p className="font-semibold text-stone-800">Customer</p>
                      <p className="text-sm text-stone-700 mt-2">{order.shippingInfo.fullName}</p>
                      <p className="text-sm text-stone-600">{order.shippingInfo.email}</p>
                      <p className="text-sm text-stone-600">{order.shippingInfo.phone}</p>
                      <p className="text-sm text-stone-600 mt-2">
                        {order.shippingInfo.address}, {order.shippingInfo.city} {order.shippingInfo.postalCode}
                      </p>

                      <div className="mt-4">
                        <label className="block text-xs uppercase tracking-wide text-stone-500 mb-1">Update status</label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <select
                            value={draftStatus[order._id] ?? order.orderStatus}
                            onChange={(e) => {
                              const selectedStatus = e.target.value as OrderStatus;
                              setDraftStatus((prev) => ({ ...prev, [order._id]: selectedStatus }));
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
                            onClick={() => handleStatusUpdate(order._id)}
                            className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white rounded-lg px-3 py-2 text-sm font-semibold"
                          >
                            {isUpdating ? 'Saving...' : 'Save'}
                          </button>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-2">
                          <input
                            type="text"
                            value={fulfillmentCourierDraft[order._id] ?? ''}
                            onChange={(event) =>
                              setFulfillmentCourierDraft((prev) => ({
                                ...prev,
                                [order._id]: event.target.value,
                              }))
                            }
                            className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Courier name (optional)"
                          />
                          <input
                            type="text"
                            value={fulfillmentTrackingNumberDraft[order._id] ?? ''}
                            onChange={(event) =>
                              setFulfillmentTrackingNumberDraft((prev) => ({
                                ...prev,
                                [order._id]: event.target.value,
                              }))
                            }
                            className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Tracking number (optional)"
                          />
                          <input
                            type="url"
                            value={fulfillmentTrackingUrlDraft[order._id] ?? ''}
                            onChange={(event) =>
                              setFulfillmentTrackingUrlDraft((prev) => ({
                                ...prev,
                                [order._id]: event.target.value,
                              }))
                            }
                            className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Tracking URL (optional)"
                          />
                        </div>
                      </div>

                      {(order.fulfillmentInfo?.courierName ||
                        order.fulfillmentInfo?.trackingNumber ||
                        order.fulfillmentInfo?.trackingUrl ||
                        order.fulfillmentInfo?.packedAt ||
                        order.fulfillmentInfo?.shippedAt ||
                        order.fulfillmentInfo?.deliveredAt) && (
                        <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
                          <p className="font-semibold uppercase tracking-wide text-indigo-800">Fulfillment</p>
                          {order.fulfillmentInfo?.courierName && (
                            <p className="mt-1">
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
                              <span className="font-semibold">Tracking URL:</span>{' '}
                              <a
                                href={order.fulfillmentInfo.trackingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                {order.fulfillmentInfo.trackingUrl}
                              </a>
                            </p>
                          )}
                          {order.fulfillmentInfo?.packedAt && (
                            <p className="mt-1">
                              <span className="font-semibold">Packed at:</span>{' '}
                              {formatDateTime(order.fulfillmentInfo.packedAt)}
                            </p>
                          )}
                          {order.fulfillmentInfo?.shippedAt && (
                            <p className="mt-1">
                              <span className="font-semibold">Shipped at:</span>{' '}
                              {formatDateTime(order.fulfillmentInfo.shippedAt)}
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

                      {cancellation?.status === 'requested' && (
                        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                            Cancellation Request
                          </p>
                          <p className="text-sm text-amber-900 mt-1">{cancellation.reason || 'No reason provided'}</p>
                          {cancellation.requestedAt && (
                            <p className="text-xs text-amber-700 mt-1">
                              Requested at: {formatDateTime(cancellation.requestedAt)}
                            </p>
                          )}
                          <textarea
                            value={cancellationNotes[order._id] ?? ''}
                            onChange={(event) =>
                              setCancellationNotes((prev) => ({
                                ...prev,
                                [order._id]: event.target.value,
                              }))
                            }
                            placeholder="Optional admin note"
                            className="mt-2 w-full min-h-20 border border-amber-300 rounded-lg px-3 py-2 text-sm"
                          />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={isReviewingCancellation}
                              onClick={() => {
                                void handleCancellationReview(order._id, 'approve');
                              }}
                              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-lg px-3 py-2 text-xs font-semibold"
                            >
                              {isReviewingCancellation ? 'Saving...' : 'Approve Cancellation'}
                            </button>
                            <button
                              type="button"
                              disabled={isReviewingCancellation}
                              onClick={() => {
                                void handleCancellationReview(order._id, 'reject');
                              }}
                              className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg px-3 py-2 text-xs font-semibold"
                            >
                              {isReviewingCancellation ? 'Saving...' : 'Reject Cancellation'}
                            </button>
                          </div>
                        </div>
                      )}

                      {cancellation?.status && cancellation.status !== 'none' && cancellation.status !== 'requested' && (
                        <div className="mt-4 rounded-lg border border-stone-200 bg-white p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-stone-700">
                            Cancellation Review
                          </p>
                          <p className="text-sm text-stone-800 mt-1 capitalize">
                            Status: {cancellation.status}
                          </p>
                          {cancellation.reason && (
                            <p className="text-sm text-stone-700 mt-1">
                              Reason: {cancellation.reason}
                            </p>
                          )}
                          {cancellation.requestedAt && (
                            <p className="text-xs text-stone-600 mt-1">
                              Requested at: {formatDateTime(cancellation.requestedAt)}
                            </p>
                          )}
                          {cancellation.reviewedAt && (
                            <p className="text-xs text-stone-600 mt-1">
                              Reviewed at: {formatDateTime(cancellation.reviewedAt)}
                            </p>
                          )}
                          {cancellation.reviewNote && (
                            <p className="text-sm text-stone-700 mt-1">
                              Admin note: {cancellation.reviewNote}
                            </p>
                          )}
                        </div>
                      )}

                      {order.orderStatus === 'cancelled' && order.paymentStatus === 'paid' && (
                        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">
                            Refund Workflow
                          </p>
                          <p className="text-sm text-blue-900 mt-1">
                            Current: <span className="font-semibold capitalize">{order.refundInfo?.status ?? 'pending'}</span>
                          </p>
                          <div className="mt-2 grid grid-cols-1 gap-2">
                            <select
                              value={refundDraftStatus[order._id] ?? 'pending'}
                              onChange={(event) =>
                                setRefundDraftStatus((prev) => ({
                                  ...prev,
                                  [order._id]: event.target.value as 'pending' | 'processed' | 'failed',
                                }))
                              }
                              className="border border-blue-300 rounded-lg px-3 py-2 text-sm"
                            >
                              <option value="pending">pending</option>
                              <option value="processed">processed</option>
                              <option value="failed">failed</option>
                            </select>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={refundDraftAmount[order._id] ?? String(order.totalAmount)}
                              onChange={(event) =>
                                setRefundDraftAmount((prev) => ({
                                  ...prev,
                                  [order._id]: event.target.value,
                                }))
                              }
                              className="border border-blue-300 rounded-lg px-3 py-2 text-sm"
                              placeholder="Refund amount"
                            />
                            <input
                              type="text"
                              value={refundDraftReference[order._id] ?? ''}
                              onChange={(event) =>
                                setRefundDraftReference((prev) => ({
                                  ...prev,
                                  [order._id]: event.target.value,
                                }))
                              }
                              className="border border-blue-300 rounded-lg px-3 py-2 text-sm"
                              placeholder="Reference (UTR, txn id)"
                            />
                            <input
                              type="text"
                              value={refundDraftGatewayRefundId[order._id] ?? ''}
                              onChange={(event) =>
                                setRefundDraftGatewayRefundId((prev) => ({
                                  ...prev,
                                  [order._id]: event.target.value,
                                }))
                              }
                              className="border border-blue-300 rounded-lg px-3 py-2 text-sm"
                              placeholder="Gateway refund id (placeholder)"
                            />
                            <select
                              value={refundDraftGatewaySettlementStatus[order._id] ?? 'unknown'}
                              onChange={(event) =>
                                setRefundDraftGatewaySettlementStatus((prev) => ({
                                  ...prev,
                                  [order._id]: event.target.value as RefundSettlementStatus,
                                }))
                              }
                              className="border border-blue-300 rounded-lg px-3 py-2 text-sm"
                            >
                              <option value="unknown">unknown</option>
                              <option value="pending">pending</option>
                              <option value="settled">settled</option>
                              <option value="failed">failed</option>
                            </select>
                            <input
                              type="datetime-local"
                              value={refundDraftGatewaySettlementAt[order._id] ?? ''}
                              onChange={(event) =>
                                setRefundDraftGatewaySettlementAt((prev) => ({
                                  ...prev,
                                  [order._id]: event.target.value,
                                }))
                              }
                              className="border border-blue-300 rounded-lg px-3 py-2 text-sm"
                            />
                            <textarea
                              value={refundDraftNote[order._id] ?? ''}
                              onChange={(event) =>
                                setRefundDraftNote((prev) => ({
                                  ...prev,
                                  [order._id]: event.target.value,
                                }))
                              }
                              className="border border-blue-300 rounded-lg px-3 py-2 text-sm min-h-20"
                              placeholder="Optional note"
                            />
                            <button
                              type="button"
                              disabled={updatingRefundOrderIds.includes(order._id)}
                              onClick={() => {
                                void handleRefundUpdate(order._id);
                              }}
                              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg px-3 py-2 text-xs font-semibold"
                            >
                              {updatingRefundOrderIds.includes(order._id) ? 'Saving...' : 'Update Refund'}
                            </button>
                          </div>
                          {order.refundInfo?.processedAt && (
                            <p className="text-xs text-blue-700 mt-2">
                              Processed at: {formatDateTime(order.refundInfo.processedAt)}
                            </p>
                          )}
                          {order.refundInfo?.reference && (
                            <p className="text-xs text-blue-700 mt-1">
                              Reference: {order.refundInfo.reference}
                            </p>
                          )}
                          {order.refundInfo?.gatewayRefundId && (
                            <p className="text-xs text-blue-700 mt-1">
                              Gateway refund id: {order.refundInfo.gatewayRefundId}
                            </p>
                          )}
                          {order.refundInfo?.gatewaySettlementStatus && (
                            <p className="text-xs text-blue-700 mt-1 capitalize">
                              Settlement status: {order.refundInfo.gatewaySettlementStatus}
                            </p>
                          )}
                          {order.refundInfo?.gatewaySettlementAt && (
                            <p className="text-xs text-blue-700 mt-1">
                              Settlement at: {formatDateTime(order.refundInfo.gatewaySettlementAt)}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
            {ordersPagination && ordersPagination.totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
                <p className="text-sm text-stone-600">
                  Page {ordersPagination.page} of {ordersPagination.totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!ordersPagination.hasPreviousPage || loading}
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    className="bg-stone-200 hover:bg-stone-300 disabled:bg-stone-100 disabled:text-stone-400 text-stone-800 rounded-lg px-4 py-2 text-sm font-semibold"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={!ordersPagination.hasNextPage || loading}
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
