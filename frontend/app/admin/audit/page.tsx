"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buildApiUrl } from '@/lib/api';
import { clearAdminToken, getAdminToken } from '@/lib/adminAuth';

type AuditOutcome = 'success' | 'failure';
type AuditActorRole = 'admin' | 'customer' | 'system' | 'anonymous';

interface AuditLog {
  _id: string;
  action: string;
  outcome: AuditOutcome;
  actorId?: string | null;
  actorRole: AuditActorRole;
  actorEmail?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
  method?: string | null;
  path?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  statusCode?: number | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditPagination {
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface AuditLogsResponse {
  success: boolean;
  message?: string;
  count?: number;
  totalCount?: number;
  auditLogs?: AuditLog[];
  pagination?: AuditPagination;
}

interface AuditRetentionStatus {
  enabled: boolean;
  retentionDays: number | null;
  intervalMinutes: number | null;
  isRunning: boolean;
  startedAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  lastDeletedCount: number | null;
  lastCutoff: string | null;
  lastDurationMs: number | null;
  lastRunMode: 'scheduled' | 'manual' | null;
  lastSkipReason: string | null;
  lastError: string | null;
}

interface AuditRetentionStatusResponse {
  success: boolean;
  message?: string;
  retention?: AuditRetentionStatus;
}

type AuditAlertSeverity = 'ok' | 'warning' | 'critical';

interface AuditAlertTopFailingAction {
  action: string;
  failureCount: number;
}

interface AuditAlertStatus {
  generatedAt: string;
  severity: AuditAlertSeverity;
  reason: string;
  triggered: boolean;
  window: {
    fromDate: string;
    toDate: string;
    minutes: number;
  };
  thresholds: {
    minEvents: number;
    warningFailureRate: number;
    criticalFailureRate: number;
  };
  metrics: {
    totalCount: number;
    successCount: number;
    failureCount: number;
    failureRate: number;
  };
  topFailingActions: AuditAlertTopFailingAction[];
}

interface AuditAlertStatusResponse {
  success: boolean;
  message?: string;
  alert?: AuditAlertStatus;
}

interface AuditAlertNotifierStatus {
  enabled: boolean;
  webhookConfigured: boolean;
  isRunning: boolean;
  startedAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  checkIntervalMinutes: number | null;
  cooldownMinutes: number | null;
  webhookTimeoutMs: number | null;
  windowMinutes: number | null;
  minEvents: number | null;
  warningFailureRate: number | null;
  criticalFailureRate: number | null;
  lastRunMode: 'scheduled' | 'manual' | null;
  lastSkipReason: string | null;
  lastError: string | null;
  lastSeverity: AuditAlertSeverity | null;
  lastReason: string | null;
  lastFailureRate: number | null;
  lastTotalCount: number | null;
  lastNotificationAt: string | null;
  lastNotificationSeverity: AuditAlertSeverity | null;
  lastNotificationReason: string | null;
  lastNotificationStatusCode: number | null;
  lastNotificationError: string | null;
}

interface AuditAlertNotifierStatusResponse {
  success: boolean;
  message?: string;
  notifier?: AuditAlertNotifierStatus;
}

interface AuditAnalyticsDay {
  date: string;
  total: number;
  success: number;
  failure: number;
}

interface AuditAnalyticsAction {
  action: string;
  total: number;
  success: number;
  failure: number;
}

interface AuditAnalyticsActor {
  actorId: string | null;
  actorEmail: string | null;
  actorRole: AuditActorRole | null;
  total: number;
}

interface AuditAnalytics {
  window: {
    fromDate: string;
    toDate: string;
    days: number;
  };
  totals: {
    totalCount: number;
    successCount: number;
    failureCount: number;
    uniqueActors: number;
    failureRate: number;
  };
  byDay: AuditAnalyticsDay[];
  topActions: AuditAnalyticsAction[];
  topActors: AuditAnalyticsActor[];
}

interface AuditAnalyticsResponse {
  success: boolean;
  message?: string;
  analytics?: AuditAnalytics;
}

interface FiltersState {
  action: string;
  actorRole: 'all' | AuditActorRole;
  outcome: 'all' | AuditOutcome;
  search: string;
  fromDate: string;
  toDate: string;
}

type FilterPreset = 'today' | 'failures' | 'admin_actions' | 'all';

const DEFAULT_FILTERS: FiltersState = {
  action: '',
  actorRole: 'all',
  outcome: 'all',
  search: '',
  fromDate: '',
  toDate: '',
};

const DEFAULT_PAGINATION: AuditPagination = {
  page: 1,
  limit: 50,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

const DEFAULT_RETENTION_STATUS: AuditRetentionStatus = {
  enabled: false,
  retentionDays: null,
  intervalMinutes: null,
  isRunning: false,
  startedAt: null,
  lastRunAt: null,
  lastSuccessAt: null,
  nextRunAt: null,
  lastDeletedCount: null,
  lastCutoff: null,
  lastDurationMs: null,
  lastRunMode: null,
  lastSkipReason: null,
  lastError: null,
};

const DEFAULT_ALERT_STATUS: AuditAlertStatus = {
  generatedAt: new Date(0).toISOString(),
  severity: 'ok',
  reason: 'healthy',
  triggered: false,
  window: {
    fromDate: new Date(0).toISOString(),
    toDate: new Date(0).toISOString(),
    minutes: 15,
  },
  thresholds: {
    minEvents: 20,
    warningFailureRate: 5,
    criticalFailureRate: 15,
  },
  metrics: {
    totalCount: 0,
    successCount: 0,
    failureCount: 0,
    failureRate: 0,
  },
  topFailingActions: [],
};

const DEFAULT_ALERT_NOTIFIER_STATUS: AuditAlertNotifierStatus = {
  enabled: false,
  webhookConfigured: false,
  isRunning: false,
  startedAt: null,
  lastRunAt: null,
  lastSuccessAt: null,
  nextRunAt: null,
  checkIntervalMinutes: null,
  cooldownMinutes: null,
  webhookTimeoutMs: null,
  windowMinutes: null,
  minEvents: null,
  warningFailureRate: null,
  criticalFailureRate: null,
  lastRunMode: null,
  lastSkipReason: null,
  lastError: null,
  lastSeverity: null,
  lastReason: null,
  lastFailureRate: null,
  lastTotalCount: null,
  lastNotificationAt: null,
  lastNotificationSeverity: null,
  lastNotificationReason: null,
  lastNotificationStatusCode: null,
  lastNotificationError: null,
};

const DEFAULT_ANALYTICS: AuditAnalytics = {
  window: {
    fromDate: new Date(0).toISOString(),
    toDate: new Date(0).toISOString(),
    days: 0,
  },
  totals: {
    totalCount: 0,
    successCount: 0,
    failureCount: 0,
    uniqueActors: 0,
    failureRate: 0,
  },
  byDay: [],
  topActions: [],
  topActors: [],
};

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

const formatDayLabel = (isoDay: string): string =>
  new Date(`${isoDay}T00:00:00.000Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });

const formatRate = (value: number): string => `${value.toFixed(2)}%`;

const getAlertSeverityStyles = (severity: AuditAlertSeverity): string => {
  if (severity === 'critical') {
    return 'border-red-300 bg-red-50 text-red-800';
  }

  if (severity === 'warning') {
    return 'border-amber-300 bg-amber-50 text-amber-800';
  }

  return 'border-emerald-300 bg-emerald-50 text-emerald-800';
};

const formatJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const toLocalDateInputValue = (date: Date): string => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return localDate.toISOString().slice(0, 10);
};

export default function AdminAuditPage() {
  const router = useRouter();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingAlertStatus, setLoadingAlertStatus] = useState(true);
  const [loadingAlertNotifier, setLoadingAlertNotifier] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [loadingRetention, setLoadingRetention] = useState(true);
  const [runningAlertNotifierNow, setRunningAlertNotifierNow] = useState(false);
  const [runningRetentionNow, setRunningRetentionNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alertStatusError, setAlertStatusError] = useState<string | null>(null);
  const [alertNotifierError, setAlertNotifierError] = useState<string | null>(null);
  const [alertNotifierInfo, setAlertNotifierInfo] = useState<string | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [retentionInfo, setRetentionInfo] = useState<string | null>(null);

  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [pagination, setPagination] = useState<AuditPagination>(DEFAULT_PAGINATION);
  const [alertStatus, setAlertStatus] = useState<AuditAlertStatus>(DEFAULT_ALERT_STATUS);
  const [alertNotifierStatus, setAlertNotifierStatus] = useState<AuditAlertNotifierStatus>(
    DEFAULT_ALERT_NOTIFIER_STATUS
  );
  const [analytics, setAnalytics] = useState<AuditAnalytics>(DEFAULT_ANALYTICS);
  const [retentionStatus, setRetentionStatus] = useState<AuditRetentionStatus>(DEFAULT_RETENTION_STATUS);

  useEffect(() => {
    const token = getAdminToken();

    if (!token) {
      router.replace('/admin/login');
      return;
    }

    setAuthToken(token);
    setIsAuthChecking(false);
  }, [router]);

  const fetchAuditLogs = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });

      if (appliedFilters.action.trim()) {
        query.set('action', appliedFilters.action.trim());
      }

      if (appliedFilters.actorRole !== 'all') {
        query.set('actorRole', appliedFilters.actorRole);
      }

      if (appliedFilters.outcome !== 'all') {
        query.set('outcome', appliedFilters.outcome);
      }

      if (appliedFilters.search.trim()) {
        query.set('search', appliedFilters.search.trim());
      }

      if (appliedFilters.fromDate) {
        query.set('fromDate', appliedFilters.fromDate);
      }

      if (appliedFilters.toDate) {
        query.set('toDate', appliedFilters.toDate);
      }

      const response = await fetch(buildApiUrl(`/api/admin/audit-logs?${query.toString()}`), {
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

      const data = (await response.json()) as AuditLogsResponse;

      if (!response.ok || !data.success || !data.auditLogs || !data.pagination) {
        throw new Error(data.message || 'Failed to fetch audit logs');
      }

      setAuditLogs(data.auditLogs);
      setTotalCount(data.totalCount ?? 0);
      setPagination(data.pagination);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, authToken, limit, page, router]);

  useEffect(() => {
    void fetchAuditLogs();
  }, [fetchAuditLogs]);

  const fetchAuditAlertStatus = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoadingAlertStatus(true);
    setAlertStatusError(null);

    try {
      const query = new URLSearchParams();

      if (appliedFilters.action.trim()) {
        query.set('action', appliedFilters.action.trim());
      }

      if (appliedFilters.actorRole !== 'all') {
        query.set('actorRole', appliedFilters.actorRole);
      }

      if (appliedFilters.search.trim()) {
        query.set('search', appliedFilters.search.trim());
      }

      const response = await fetch(buildApiUrl(`/api/admin/audit-alerts/status?${query.toString()}`), {
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

      const data = (await response.json()) as AuditAlertStatusResponse;

      if (!response.ok || !data.success || !data.alert) {
        throw new Error(data.message || 'Failed to fetch alert status');
      }

      setAlertStatus(data.alert);
    } catch (fetchError) {
      setAlertStatusError(fetchError instanceof Error ? fetchError.message : 'Unable to load alert status');
      setAlertStatus(DEFAULT_ALERT_STATUS);
    } finally {
      setLoadingAlertStatus(false);
    }
  }, [appliedFilters, authToken, router]);

  useEffect(() => {
    void fetchAuditAlertStatus();
  }, [fetchAuditAlertStatus]);

  useEffect(() => {
    if (!authToken) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchAuditAlertStatus();
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authToken, fetchAuditAlertStatus]);

  const fetchAuditAlertNotifierStatus = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoadingAlertNotifier(true);
    setAlertNotifierError(null);

    try {
      const response = await fetch(buildApiUrl('/api/admin/audit-alerts/notifier/status'), {
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

      const data = (await response.json()) as AuditAlertNotifierStatusResponse;

      if (!response.ok || !data.success || !data.notifier) {
        throw new Error(data.message || 'Failed to fetch notifier status');
      }

      setAlertNotifierStatus(data.notifier);
    } catch (fetchError) {
      setAlertNotifierError(
        fetchError instanceof Error ? fetchError.message : 'Unable to load notifier status'
      );
      setAlertNotifierStatus(DEFAULT_ALERT_NOTIFIER_STATUS);
    } finally {
      setLoadingAlertNotifier(false);
    }
  }, [authToken, router]);

  useEffect(() => {
    void fetchAuditAlertNotifierStatus();
  }, [fetchAuditAlertNotifierStatus]);

  const handleRunAlertNotifierNow = async () => {
    if (!authToken) {
      return;
    }

    setRunningAlertNotifierNow(true);
    setAlertNotifierError(null);
    setAlertNotifierInfo(null);

    try {
      const response = await fetch(buildApiUrl('/api/admin/audit-alerts/notifier/run'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as { success?: boolean; message?: string };

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to run notifier manually');
      }

      setAlertNotifierInfo(data.message || 'Manual notifier run completed.');
      await fetchAuditAlertNotifierStatus();
      await fetchAuditAlertStatus();
    } catch (runError) {
      setAlertNotifierError(
        runError instanceof Error ? runError.message : 'Failed to run notifier manually'
      );
    } finally {
      setRunningAlertNotifierNow(false);
    }
  };

  const fetchAuditAnalytics = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoadingAnalytics(true);
    setAnalyticsError(null);

    try {
      const query = new URLSearchParams({
        top: '5',
      });

      if (!appliedFilters.fromDate && !appliedFilters.toDate) {
        query.set('days', '14');
      }

      if (appliedFilters.action.trim()) {
        query.set('action', appliedFilters.action.trim());
      }

      if (appliedFilters.actorRole !== 'all') {
        query.set('actorRole', appliedFilters.actorRole);
      }

      if (appliedFilters.outcome !== 'all') {
        query.set('outcome', appliedFilters.outcome);
      }

      if (appliedFilters.search.trim()) {
        query.set('search', appliedFilters.search.trim());
      }

      if (appliedFilters.fromDate) {
        query.set('fromDate', appliedFilters.fromDate);
      }

      if (appliedFilters.toDate) {
        query.set('toDate', appliedFilters.toDate);
      }

      const response = await fetch(buildApiUrl(`/api/admin/audit-logs/analytics?${query.toString()}`), {
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

      const data = (await response.json()) as AuditAnalyticsResponse;

      if (!response.ok || !data.success || !data.analytics) {
        throw new Error(data.message || 'Failed to fetch analytics');
      }

      setAnalytics(data.analytics);
    } catch (fetchError) {
      setAnalyticsError(fetchError instanceof Error ? fetchError.message : 'Unable to load analytics');
      setAnalytics(DEFAULT_ANALYTICS);
    } finally {
      setLoadingAnalytics(false);
    }
  }, [appliedFilters, authToken, router]);

  useEffect(() => {
    void fetchAuditAnalytics();
  }, [fetchAuditAnalytics]);

  const fetchRetentionStatus = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoadingRetention(true);
    setRetentionError(null);
    setRetentionInfo(null);

    try {
      const response = await fetch(buildApiUrl('/api/admin/audit-retention/status'), {
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

      const data = (await response.json()) as AuditRetentionStatusResponse;

      if (!response.ok || !data.success || !data.retention) {
        throw new Error(data.message || 'Failed to fetch retention status');
      }

      setRetentionStatus(data.retention);
    } catch (fetchError) {
      setRetentionError(fetchError instanceof Error ? fetchError.message : 'Unable to load retention status');
    } finally {
      setLoadingRetention(false);
    }
  }, [authToken, router]);

  useEffect(() => {
    void fetchRetentionStatus();
  }, [fetchRetentionStatus]);

  const summary = useMemo(() => {
    const successCount = auditLogs.filter((log) => log.outcome === 'success').length;
    const failureCount = auditLogs.filter((log) => log.outcome === 'failure').length;

    return {
      pageCount: auditLogs.length,
      totalCount,
      successCount,
      failureCount,
    };
  }, [auditLogs, totalCount]);

  const maxByDayTotal = useMemo(
    () => Math.max(1, ...analytics.byDay.map((entry) => entry.total)),
    [analytics.byDay]
  );

  const maxTopActionTotal = useMemo(
    () => Math.max(1, ...analytics.topActions.map((entry) => entry.total)),
    [analytics.topActions]
  );

  const handleApplyFilters = () => {
    setPage(1);
    setAppliedFilters(filters);
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setPage(1);
    setLimit(50);
  };

  const applyPreset = (preset: FilterPreset) => {
    const today = toLocalDateInputValue(new Date());
    const nextFilters: FiltersState =
      preset === 'today'
        ? {
            ...DEFAULT_FILTERS,
            fromDate: today,
            toDate: today,
          }
        : preset === 'failures'
          ? {
              ...DEFAULT_FILTERS,
              outcome: 'failure',
            }
          : preset === 'admin_actions'
            ? {
                ...DEFAULT_FILTERS,
                actorRole: 'admin',
              }
            : DEFAULT_FILTERS;

    setFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setPage(1);
  };

  const handleExportCsv = async () => {
    if (!authToken) {
      return;
    }

    setExporting(true);
    setError(null);

    try {
      const query = new URLSearchParams({
        limit: '5000',
      });

      if (appliedFilters.action.trim()) {
        query.set('action', appliedFilters.action.trim());
      }

      if (appliedFilters.actorRole !== 'all') {
        query.set('actorRole', appliedFilters.actorRole);
      }

      if (appliedFilters.outcome !== 'all') {
        query.set('outcome', appliedFilters.outcome);
      }

      if (appliedFilters.search.trim()) {
        query.set('search', appliedFilters.search.trim());
      }

      if (appliedFilters.fromDate) {
        query.set('fromDate', appliedFilters.fromDate);
      }

      if (appliedFilters.toDate) {
        query.set('toDate', appliedFilters.toDate);
      }

      const response = await fetch(buildApiUrl(`/api/admin/audit-logs/export?${query.toString()}`), {
        method: 'GET',
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
        const data = (await response.json()) as { message?: string };
        throw new Error(data.message || 'Failed to export audit logs');
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      const matchedFilename = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = matchedFilename?.[1] || `audit-logs-${Date.now()}.csv`;

      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export audit logs');
    } finally {
      setExporting(false);
    }
  };

  const handleLogout = () => {
    clearAdminToken();
    router.replace('/admin/login');
  };

  const handleRunRetentionNow = async () => {
    if (!authToken) {
      return;
    }

    setRunningRetentionNow(true);
    setRetentionError(null);
    setRetentionInfo(null);

    try {
      const response = await fetch(buildApiUrl('/api/admin/audit-retention/run'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as { success?: boolean; message?: string };

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to run retention manually');
      }

      setRetentionInfo(data.message || 'Manual retention run completed.');
      await fetchRetentionStatus();
      await fetchAuditLogs();
      await fetchAuditAlertNotifierStatus();
      await fetchAuditAlertStatus();
      await fetchAuditAnalytics();
    } catch (runError) {
      setRetentionError(runError instanceof Error ? runError.message : 'Failed to run retention manually');
    } finally {
      setRunningRetentionNow(false);
    }
  };

  if (isAuthChecking || loading) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6 sm:py-10 lg:p-10 flex items-center justify-center">
        <p className="text-lg text-stone-700">Loading audit logs...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-stone-900">Audit Trail</h1>
            <p className="text-stone-600 mt-2">
              Inspect sensitive system actions with actor, request, and resource traceability.
            </p>
          </div>
          <div className="self-start md:self-auto flex gap-2">
            <button
              type="button"
              disabled={exporting}
              onClick={() => {
                void handleExportCsv();
              }}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white px-4 py-2 rounded-lg text-sm font-semibold"
            >
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="bg-stone-800 hover:bg-black text-white px-4 py-2 rounded-lg text-sm font-semibold"
            >
              Logout
            </button>
          </div>
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
          <Link href="/admin/feedback" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Feedback
          </Link>
          <Link href="/admin/audit" className="px-3 py-2 rounded-lg text-sm font-semibold bg-amber-100 text-amber-800">
            Audit
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Matched Logs</p>
            <p className="text-3xl font-black text-stone-900 mt-1">{summary.totalCount}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Current Page</p>
            <p className="text-3xl font-black text-stone-900 mt-1">{summary.pageCount}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Success (Page)</p>
            <p className="text-3xl font-black text-emerald-700 mt-1">{summary.successCount}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Failure (Page)</p>
            <p className="text-3xl font-black text-red-700 mt-1">{summary.failureCount}</p>
          </div>
        </div>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Live Alert Status</h2>
              <p className="text-sm text-stone-600 mt-1">
                Rolling failure-rate signal over the recent event window.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void fetchAuditAlertStatus();
              }}
              disabled={loadingAlertStatus}
              className="bg-stone-200 hover:bg-stone-300 disabled:bg-stone-100 text-stone-800 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              {loadingAlertStatus ? 'Refreshing...' : 'Refresh Alert'}
            </button>
          </div>

          {alertStatusError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
              {alertStatusError}
            </div>
          )}

          {!alertStatusError && (
            <div className={`mt-4 rounded-xl border px-4 py-3 ${getAlertSeverityStyles(alertStatus.severity)}`}>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <p className="text-sm font-semibold uppercase tracking-wide">Severity: {alertStatus.severity}</p>
                <p className="text-xs">
                  Updated {formatDateTime(alertStatus.generatedAt)} | Window {alertStatus.window.minutes} min
                </p>
              </div>
              <p className="text-sm mt-2">{alertStatus.reason}</p>
            </div>
          )}

          {!alertStatusError && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Events</p>
                <p className="mt-1 font-semibold text-stone-900">{alertStatus.metrics.totalCount}</p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Failures</p>
                <p className="mt-1 font-semibold text-red-700">{alertStatus.metrics.failureCount}</p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Failure Rate</p>
                <p className="mt-1 font-semibold text-stone-900">{formatRate(alertStatus.metrics.failureRate)}</p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Warning At</p>
                <p className="mt-1 font-semibold text-stone-900">
                  {formatRate(alertStatus.thresholds.warningFailureRate)}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Critical At</p>
                <p className="mt-1 font-semibold text-stone-900">
                  {formatRate(alertStatus.thresholds.criticalFailureRate)}
                </p>
              </div>
            </div>
          )}

          {!alertStatusError && (
            <div className="mt-4 rounded-xl border border-stone-100 bg-stone-50 p-4">
              <h3 className="text-sm font-semibold text-stone-800">Top Failing Actions (Window)</h3>
              <div className="mt-3 space-y-2">
                {alertStatus.topFailingActions.length === 0 ? (
                  <p className="text-sm text-stone-500">No failing actions in the current window.</p>
                ) : (
                  alertStatus.topFailingActions.map((entry) => (
                    <div key={entry.action} className="flex items-start justify-between gap-3 text-sm">
                      <p className="text-stone-700 break-all">{entry.action}</p>
                      <p className="text-red-700 font-semibold">{entry.failureCount}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Notifier Health</h2>
              <p className="text-sm text-stone-600 mt-1">
                Background monitor that checks alert severity and posts webhook notifications.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void fetchAuditAlertNotifierStatus();
                }}
                disabled={loadingAlertNotifier}
                className="bg-stone-200 hover:bg-stone-300 disabled:bg-stone-100 text-stone-800 rounded-lg px-4 py-2 text-sm font-semibold"
              >
                {loadingAlertNotifier ? 'Refreshing...' : 'Refresh Notifier'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleRunAlertNotifierNow();
                }}
                disabled={runningAlertNotifierNow || loadingAlertNotifier}
                className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg px-4 py-2 text-sm font-semibold"
              >
                {runningAlertNotifierNow ? 'Running...' : 'Run Notifier Now'}
              </button>
            </div>
          </div>

          {alertNotifierError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
              {alertNotifierError}
            </div>
          )}

          {alertNotifierInfo && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700 text-sm">
              {alertNotifierInfo}
            </div>
          )}

          {!alertNotifierError && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Monitor State</p>
                <p className="mt-1 font-semibold text-stone-900">
                  {alertNotifierStatus.enabled
                    ? alertNotifierStatus.isRunning
                      ? 'Running'
                      : 'Active'
                    : 'Disabled'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Webhook</p>
                <p className="mt-1 font-semibold text-stone-900">
                  {alertNotifierStatus.webhookConfigured ? 'Configured' : 'Not configured'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Last Severity</p>
                <p className="mt-1 font-semibold text-stone-900">
                  {alertNotifierStatus.lastSeverity || 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Last Failure Rate</p>
                <p className="mt-1 font-semibold text-stone-900">
                  {alertNotifierStatus.lastFailureRate !== null
                    ? formatRate(alertNotifierStatus.lastFailureRate)
                    : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Last Event Count</p>
                <p className="mt-1 font-semibold text-stone-900">
                  {alertNotifierStatus.lastTotalCount ?? 'N/A'}
                </p>
              </div>
            </div>
          )}

          {!alertNotifierError && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Check Interval</p>
                <p className="mt-1 text-stone-800">
                  {alertNotifierStatus.checkIntervalMinutes !== null
                    ? `${alertNotifierStatus.checkIntervalMinutes} min`
                    : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Cooldown</p>
                <p className="mt-1 text-stone-800">
                  {alertNotifierStatus.cooldownMinutes !== null
                    ? `${alertNotifierStatus.cooldownMinutes} min`
                    : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Alert Window</p>
                <p className="mt-1 text-stone-800">
                  {alertNotifierStatus.windowMinutes !== null
                    ? `${alertNotifierStatus.windowMinutes} min`
                    : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Min Events</p>
                <p className="mt-1 text-stone-800">
                  {alertNotifierStatus.minEvents !== null ? alertNotifierStatus.minEvents : 'N/A'}
                </p>
              </div>
            </div>
          )}

          {!alertNotifierError && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Last Run</p>
                <p className="mt-1 text-stone-800">
                  {alertNotifierStatus.lastRunAt ? formatDateTime(alertNotifierStatus.lastRunAt) : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Next Run</p>
                <p className="mt-1 text-stone-800">
                  {alertNotifierStatus.nextRunAt ? formatDateTime(alertNotifierStatus.nextRunAt) : 'N/A'}
                </p>
              </div>
            </div>
          )}

          {!alertNotifierError && alertNotifierStatus.lastNotificationAt && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800 text-sm">
              Last Notification: {formatDateTime(alertNotifierStatus.lastNotificationAt)} (
              {alertNotifierStatus.lastNotificationSeverity || 'n/a'})
            </div>
          )}

          {!alertNotifierError && alertNotifierStatus.lastNotificationReason && (
            <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-stone-700 text-sm break-all">
              Last Notification Reason: {alertNotifierStatus.lastNotificationReason}
            </div>
          )}

          {!alertNotifierError && alertNotifierStatus.lastNotificationError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm break-all">
              Last Notification Error: {alertNotifierStatus.lastNotificationError}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Analytics Snapshot</h2>
              <p className="text-sm text-stone-600 mt-1">
                Trend and concentration view for the currently applied filters.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void fetchAuditAnalytics();
              }}
              disabled={loadingAnalytics}
              className="bg-stone-200 hover:bg-stone-300 disabled:bg-stone-100 text-stone-800 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              {loadingAnalytics ? 'Refreshing...' : 'Refresh Analytics'}
            </button>
          </div>

          {analyticsError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
              {analyticsError}
            </div>
          )}

          {!analyticsError && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Window</p>
                <p className="mt-1 font-semibold text-stone-900">{analytics.window.days} days</p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Total</p>
                <p className="mt-1 font-semibold text-stone-900">{analytics.totals.totalCount}</p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Failures</p>
                <p className="mt-1 font-semibold text-red-700">{analytics.totals.failureCount}</p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Failure Rate</p>
                <p className="mt-1 font-semibold text-red-700">{analytics.totals.failureRate}%</p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Unique Actors</p>
                <p className="mt-1 font-semibold text-stone-900">{analytics.totals.uniqueActors}</p>
              </div>
            </div>
          )}

          {!analyticsError && (
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                <h3 className="text-sm font-semibold text-stone-800">Daily Trend</h3>
                <div className="mt-3 space-y-2">
                  {analytics.byDay.length === 0 ? (
                    <p className="text-sm text-stone-500">No trend data for selected range.</p>
                  ) : (
                    analytics.byDay.map((entry) => (
                      <div key={entry.date}>
                        <div className="flex items-center justify-between text-xs text-stone-600 mb-1">
                          <span>{formatDayLabel(entry.date)}</span>
                          <span>{entry.total}</span>
                        </div>
                        <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full"
                            style={{
                              width: `${Math.max(6, Math.round((entry.total / maxByDayTotal) * 100))}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                <h3 className="text-sm font-semibold text-stone-800">Top Actions</h3>
                <div className="mt-3 space-y-3">
                  {analytics.topActions.length === 0 ? (
                    <p className="text-sm text-stone-500">No action concentration detected.</p>
                  ) : (
                    analytics.topActions.map((entry) => (
                      <div key={entry.action}>
                        <div className="flex items-start justify-between gap-3 text-xs">
                          <p className="text-stone-700 break-all">{entry.action}</p>
                          <p className="text-stone-900 font-semibold">{entry.total}</p>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-stone-200 overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{
                              width: `${Math.max(6, Math.round((entry.total / maxTopActionTotal) * 100))}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {!analyticsError && (
            <div className="mt-4 rounded-xl border border-stone-100 bg-stone-50 p-4">
              <h3 className="text-sm font-semibold text-stone-800">Top Actors</h3>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {analytics.topActors.length === 0 ? (
                  <p className="text-sm text-stone-500">No actor data available for selected filters.</p>
                ) : (
                  analytics.topActors.map((entry, index) => (
                    <div key={`${entry.actorId || 'unknown'}-${index}`} className="rounded-xl border border-stone-200 bg-white p-3">
                      <p className="text-xs uppercase tracking-wide text-stone-500">{entry.actorRole || 'unknown'}</p>
                      <p className="text-sm text-stone-900 font-semibold mt-1 break-all">
                        {entry.actorEmail || entry.actorId || 'Unknown actor'}
                      </p>
                      <p className="text-xs text-stone-600 mt-1">Events: {entry.total}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Retention Health</h2>
              <p className="text-sm text-stone-600 mt-1">
                Operational status of automated audit log pruning.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void fetchRetentionStatus();
              }}
              disabled={loadingRetention}
              className="bg-stone-200 hover:bg-stone-300 disabled:bg-stone-100 text-stone-800 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              {loadingRetention ? 'Refreshing...' : 'Refresh Status'}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleRunRetentionNow();
              }}
              disabled={runningRetentionNow || loadingRetention}
              className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg px-4 py-2 text-sm font-semibold"
            >
              {runningRetentionNow ? 'Running...' : 'Run Retention Now'}
            </button>
          </div>

          {retentionError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
              {retentionError}
            </div>
          )}

          {retentionInfo && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700 text-sm">
              {retentionInfo}
            </div>
          )}

          {!retentionError && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Job State</p>
                <p className="mt-1 font-semibold text-stone-900">
                  {retentionStatus.enabled ? (retentionStatus.isRunning ? 'Running' : 'Active') : 'Disabled'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Retention</p>
                <p className="mt-1 font-semibold text-stone-900">
                  {retentionStatus.retentionDays !== null ? `${retentionStatus.retentionDays} days` : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Last Deleted</p>
                <p className="mt-1 font-semibold text-stone-900">
                  {retentionStatus.lastDeletedCount !== null ? retentionStatus.lastDeletedCount : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Last Mode</p>
                <p className="mt-1 font-semibold text-stone-900">
                  {retentionStatus.lastRunMode || 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Interval</p>
                <p className="mt-1 font-semibold text-stone-900">
                  {retentionStatus.intervalMinutes !== null ? `${retentionStatus.intervalMinutes} min` : 'N/A'}
                </p>
              </div>
            </div>
          )}

          {!retentionError && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Last Run</p>
                <p className="mt-1 text-stone-800">
                  {retentionStatus.lastRunAt ? formatDateTime(retentionStatus.lastRunAt) : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Next Run</p>
                <p className="mt-1 text-stone-800">
                  {retentionStatus.nextRunAt ? formatDateTime(retentionStatus.nextRunAt) : 'N/A'}
                </p>
              </div>
            </div>
          )}

          {!retentionError && retentionStatus.lastSkipReason && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-sm break-all">
              Last Skip Reason: {retentionStatus.lastSkipReason}
            </div>
          )}

          {!retentionError && retentionStatus.lastError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm break-all">
              Last Error: {retentionStatus.lastError}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Action (e.g. orders.status.update)"
              value={filters.action}
              onChange={(e) => setFilters((prev) => ({ ...prev, action: e.target.value }))}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />

            <select
              value={filters.actorRole}
              onChange={(e) => setFilters((prev) => ({ ...prev, actorRole: e.target.value as FiltersState['actorRole'] }))}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Roles</option>
              <option value="admin">admin</option>
              <option value="customer">customer</option>
              <option value="system">system</option>
              <option value="anonymous">anonymous</option>
            </select>

            <select
              value={filters.outcome}
              onChange={(e) => setFilters((prev) => ({ ...prev, outcome: e.target.value as FiltersState['outcome'] }))}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Outcomes</option>
              <option value="success">success</option>
              <option value="failure">failure</option>
            </select>

            <input
              type="text"
              placeholder="Search request/resource/actor"
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />

            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => setFilters((prev) => ({ ...prev, fromDate: e.target.value }))}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />

            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => setFilters((prev) => ({ ...prev, toDate: e.target.value }))}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyPreset('today')}
                className="bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg px-3 py-2 text-sm font-semibold"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => applyPreset('failures')}
                className="bg-red-100 hover:bg-red-200 text-red-800 rounded-lg px-3 py-2 text-sm font-semibold"
              >
                Failures
              </button>
              <button
                type="button"
                onClick={() => applyPreset('admin_actions')}
                className="bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg px-3 py-2 text-sm font-semibold"
              >
                Admin Actions
              </button>
              <button
                type="button"
                onClick={() => applyPreset('all')}
                className="bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg px-3 py-2 text-sm font-semibold"
              >
                Clear Presets
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <div className="flex gap-2 sm:max-w-xs w-full">
              <label className="text-sm text-stone-600 self-center">Per page</label>
              <select
                value={limit}
                onChange={(e) => {
                  const nextLimit = Number(e.target.value);
                  setLimit(nextLimit);
                  setPage(1);
                }}
                className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleApplyFilters}
              className="bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Apply Filters
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
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

        {auditLogs.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-6 sm:p-10 text-center text-stone-600">
            No audit logs found for current filters.
          </div>
        ) : (
          <div className="space-y-4">
            {auditLogs.map((log) => (
              <article key={log._id} className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-stone-500">Action</p>
                    <p className="font-semibold text-stone-900 break-all">{log.action}</p>
                    <p className="text-sm text-stone-500 mt-1">{formatDateTime(log.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${
                        log.outcome === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {log.outcome}
                    </span>
                    <span className="px-3 py-1 rounded-full bg-stone-100 text-stone-700 text-xs font-semibold">
                      {log.actorRole}
                    </span>
                    {typeof log.statusCode === 'number' && (
                      <span className="px-3 py-1 rounded-full bg-stone-100 text-stone-700 text-xs font-semibold">
                        HTTP {log.statusCode}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm">
                  <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                    <p className="text-xs uppercase tracking-wide text-stone-500">Actor</p>
                    <p className="text-stone-800 mt-1 break-all">{log.actorEmail || log.actorId || 'Unknown actor'}</p>
                    <p className="text-stone-600 mt-1 break-all">Actor ID: {log.actorId || 'N/A'}</p>
                  </div>

                  <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                    <p className="text-xs uppercase tracking-wide text-stone-500">Request</p>
                    <p className="text-stone-800 mt-1 break-all">Request ID: {log.requestId || 'N/A'}</p>
                    <p className="text-stone-600 mt-1 break-all">
                      {log.method || 'N/A'} {log.path || ''}
                    </p>
                    <p className="text-stone-600 mt-1 break-all">IP: {log.ipAddress || 'N/A'}</p>
                  </div>

                  <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                    <p className="text-xs uppercase tracking-wide text-stone-500">Resource</p>
                    <p className="text-stone-800 mt-1 break-all">{log.resourceType || 'N/A'}</p>
                    <p className="text-stone-600 mt-1 break-all">Resource ID: {log.resourceId || 'N/A'}</p>
                  </div>
                </div>

                {log.metadata && (
                  <details className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-stone-700">
                      View Metadata
                    </summary>
                    <pre className="mt-2 text-xs text-stone-700 whitespace-pre-wrap break-all">
                      {formatJson(log.metadata)}
                    </pre>
                  </details>
                )}
              </article>
            ))}
          </div>
        )}

        <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-stone-600">
              Page {pagination.page} of {Math.max(1, pagination.totalPages)}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!pagination.hasPreviousPage}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                className="bg-stone-200 hover:bg-stone-300 disabled:bg-stone-100 disabled:text-stone-400 text-stone-800 rounded-lg px-3 py-2 text-sm font-semibold"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!pagination.hasNextPage}
                onClick={() => setPage((prev) => prev + 1)}
                className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg px-3 py-2 text-sm font-semibold"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
