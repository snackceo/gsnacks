// Simple stat card component
const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; subtitle?: string }> = ({ icon, label, value, subtitle }) => (
  <div className="bg-white/5 rounded-xl p-4 border border-white/10 flex flex-col items-start">
    <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</span></div>
    <div className="text-2xl font-black text-white">{value}</div>
    {subtitle && <div className="text-xs text-slate-400 mt-1">{subtitle}</div>}
  </div>
);
import React, { useState, useEffect, useMemo } from 'react';
import { useNinpoCore } from '../../hooks/useNinpoCore';
import { ErrorMonitorPanel } from './ErrorMonitorPanel';
import { BarChart3, ShieldAlert, Loader2, BrainCircuit, TrendingUp, Users, ShoppingCart, Package, RefreshCw, TrendingDown, Sparkles } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Order } from '../../types';
import { analytics } from '../../services/analyticsService';
import { getDemandForecast, DemandForecastItem } from '../../services/geminiService';
import { apiFetch } from '../../utils/apiFetch';

// Parse job status badge colors
const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    CREATED: 'bg-zinc-500/20 text-zinc-200',
    QUEUED: 'bg-slate-500/20 text-slate-200',
    PARSING: 'bg-blue-500/20 text-blue-300',
    PARSED: 'bg-green-500/20 text-green-300',
    NEEDS_REVIEW: 'bg-yellow-500/20 text-yellow-300',
    FAILED: 'bg-red-500/20 text-red-300',
    APPROVED: 'bg-ninpo-lime/20 text-ninpo-lime',
    REJECTED: 'bg-red-900/30 text-red-400',
    COMMITTED: 'bg-ninpo-lime/30 text-ninpo-lime',
  };
  return map[status] || 'bg-slate-700/20 text-slate-300';
};

const PARSE_JOB_FILTERS_KEY = 'ninpo.management.parseJobFilters';

const getHashParams = () => {
  if (typeof window === 'undefined') return new URLSearchParams();
  const [, query = ''] = window.location.hash.split('?');
  return new URLSearchParams(query);
};

const updateHashParams = (next: Record<string, string | number | null | undefined>) => {
  if (typeof window === 'undefined') return;
  const params = getHashParams();
  Object.entries(next).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  });
  const [path] = window.location.hash.split('?');
  const query = params.toString();
  window.history.replaceState({}, '', `${path}${query ? `?${query}` : ''}`);
};

const readStoredParseJobFilters = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PARSE_JOB_FILTERS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as {
      storeFilter?: string;
      statusFilter?: string;
      dateFilter?: string;
      alertFilter?: 'all' | 'failed' | 'warnings';
      pageSize?: number;
    };
  } catch {
    return null;
  }
};

const persistParseJobFilters = (filters: {
  storeFilter: string;
  statusFilter: string;
  dateFilter: string;
  alertFilter: 'all' | 'failed' | 'warnings';
  pageSize: number;
}) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PARSE_JOB_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // ignore storage failures
  }
};

// Parse job history panel with error toast
const ParseJobHistoryPanel: React.FC = () => {
  const storedFilters = readStoredParseJobFilters();
  const hashParams = getHashParams();
  const hashStore = hashParams.get('receiptStore') || '';
  const hashStatus = hashParams.get('receiptStatus') || '';
  const hashDate = hashParams.get('receiptDate') || '';
  const hashAlert = (hashParams.get('receiptAlert') as 'all' | 'failed' | 'warnings') || '';
  const hashPageSize = Number(hashParams.get('receiptPageSize')) || 0;
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [storeFilter, setStoreFilter] = useState(hashStore || storedFilters?.storeFilter || '');
  const [statusFilter, setStatusFilter] = useState(hashStatus || storedFilters?.statusFilter || '');
  const [dateFilter, setDateFilter] = useState(hashDate || storedFilters?.dateFilter || '');
  const [selectedJob, setSelectedJob] = useState<any|null>(null);
  const [isRetrying, setIsRetrying] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(hashPageSize || storedFilters?.pageSize || 50);
  const [alertFilter, setAlertFilter] = useState<'all' | 'failed' | 'warnings'>(
    hashAlert || storedFilters?.alertFilter || 'all'
  );
  const [copiedLink, setCopiedLink] = useState(false);
  const toastSummaryRef = React.useRef<string | null>(null);
  const { addToast } = useNinpoCore();

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    apiFetch<{ jobs?: any[]; error?: string }>(`/api/receipts?limit=${pageSize}`)
      .then(data => {
        if (!isMounted) return;
        if (data?.jobs) {
          setJobs(data.jobs);
          const errorCount = data.jobs.filter((job: any) => job.parseError).length;
          const warningCount = data.jobs.filter(
            (job: any) => Array.isArray(job.warnings) && job.warnings.length > 0
          ).length;
          const summary = `${errorCount}:${warningCount}:${pageSize}`;
          if (summary !== toastSummaryRef.current) {
            toastSummaryRef.current = summary;
            if (errorCount > 0 || warningCount > 0) {
              addToast(
                `Parse alerts: ${errorCount} failed, ${warningCount} warnings in latest ${pageSize}`,
                'warning'
              );
            }
          }
        } else {
          setError(data?.error || 'No jobs found');
          addToast(data?.error || 'No jobs found', 'error');
        }
      })
      .catch(e => {
        if (!isMounted) return;
        setError(e?.message || 'Failed to load jobs');
        addToast(e?.message || 'Failed to load jobs', 'error');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [addToast, pageSize]);

  // Unique store and status options for filters
  const storeOptions = Array.from(new Set(jobs.map(j => j.storeCandidate?.name).filter(Boolean)));
  const statusOptions = Array.from(new Set(jobs.map(j => j.status).filter(Boolean)));

  // Filtered jobs
  const filteredJobs = jobs.filter(job => {
    const matchesStore = !storeFilter || job.storeCandidate?.name === storeFilter;
    const matchesStatus = !statusFilter || job.status === statusFilter;
    const matchesDate = !dateFilter || (job.createdAt && job.createdAt.startsWith(dateFilter));
    const hasWarnings = Array.isArray(job.warnings) && job.warnings.length > 0;
    const hasError = Boolean(job.parseError);
    const matchesAlertFilter =
      alertFilter === 'all' ||
      (alertFilter === 'failed' && hasError) ||
      (alertFilter === 'warnings' && hasWarnings);
    return matchesStore && matchesStatus && matchesDate && matchesAlertFilter;
  });

  useEffect(() => {
    persistParseJobFilters({
      storeFilter,
      statusFilter,
      dateFilter,
      alertFilter,
      pageSize
    });
    updateHashParams({
      receiptStore: storeFilter,
      receiptStatus: statusFilter,
      receiptDate: dateFilter,
      receiptAlert: alertFilter === 'all' ? '' : alertFilter,
      receiptPageSize: pageSize
    });
  }, [storeFilter, statusFilter, dateFilter, alertFilter, pageSize]);

  const handleCopyLink = async () => {
    const hash = window.location.hash || '#/management';
    const link = `${window.location.origin}${window.location.pathname}${hash}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      addToast('Filter link copied', 'success');
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      addToast('Unable to copy link', 'warning');
    }
  };

  const handleExport = () => {
    if (filteredJobs.length === 0) {
      addToast('No jobs to export', 'info');
      return;
    }
    const rows = [
      ['Capture ID', 'Store', 'Status', 'Created', 'Error'].join(','),
      ...filteredJobs.map(job => [
        job.captureId || '',
        `"${(job.storeCandidate?.name || '').replace(/"/g, '""')}"`,
        job.status || '',
        job.createdAt || '',
        `"${(job.parseError || '').replace(/"/g, '""')}"`
      ].join(','))
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `receipt-parse-jobs-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRetry = async (job: any) => {
    if (!job?.captureId) return;
    setIsRetrying(job.captureId);
    try {
      await apiFetch('/api/driver/receipt-parse', {
        method: 'POST',
        body: JSON.stringify({ captureId: job.captureId })
      });
      addToast('Receipt parse retry started.', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to retry parse', 'error');
    } finally {
      setIsRetrying(null);
    }
  };

  return (
    <div className="bg-white/5 rounded-xl p-6 border border-white/10 mt-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
          <Package className="w-4 h-4 text-ninpo-lime" /> Parse Job History
        </h3>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCopyLink}
            className="text-xs font-bold text-white/80 hover:text-white bg-white/10 px-3 py-1 rounded-lg"
          >
            {copiedLink ? 'Copied' : 'Copy Link'}
          </button>
          <button
            onClick={() => setPageSize(prev => prev + 50)}
            className="text-xs font-bold text-white/80 hover:text-white bg-white/10 px-3 py-1 rounded-lg"
          >
            Load More
          </button>
          <button
            onClick={handleExport}
            className="text-xs font-bold text-white/80 hover:text-white bg-white/10 px-3 py-1 rounded-lg"
          >
            Export CSV
          </button>
          <a href="#/management/receipts" className="text-xs font-bold text-ninpo-lime hover:underline">View All</a>
        </div>
      </div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAlertFilter('all')}
            className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-lg border ${
              alertFilter === 'all'
                ? 'border-white/40 text-white bg-white/10'
                : 'border-white/10 text-slate-400'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setAlertFilter('failed')}
            className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-lg border ${
              alertFilter === 'failed'
                ? 'border-red-400/60 text-red-200 bg-red-500/10'
                : 'border-white/10 text-slate-400'
            }`}
          >
            Failed
          </button>
          <button
            onClick={() => setAlertFilter('warnings')}
            className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-lg border ${
              alertFilter === 'warnings'
                ? 'border-amber-400/60 text-amber-200 bg-amber-500/10'
                : 'border-white/10 text-slate-400'
            }`}
          >
            Warnings
          </button>
        </div>
        <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="rounded px-2 py-1 text-xs bg-ninpo-midnight text-white border border-white/10">
          <option value="">All Stores</option>
          {storeOptions.map(store => <option key={store} value={store}>{store}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="rounded px-2 py-1 text-xs bg-ninpo-midnight text-white border border-white/10">
          <option value="">All Statuses</option>
          {statusOptions.map(status => <option key={status} value={status}>{status}</option>)}
        </select>
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="rounded px-2 py-1 text-xs bg-ninpo-midnight text-white border border-white/10" />
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-ninpo-lime" /></div>
      ) : error ? (
        <div className="text-red-400 text-xs p-2">{error}</div>
      ) : filteredJobs.length === 0 ? (
        <div className="text-slate-400 text-xs p-2">No jobs match filter.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="px-2 py-1 text-left">SKU</th>
                <th className="px-2 py-1 text-left">Store</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-left">Created</th>
                <th className="px-2 py-1 text-left">Error</th>
                <th className="px-2 py-1 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map(job => (
                <tr key={job._id} className="border-b border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => setSelectedJob(job)}>
                  <td className="px-2 py-1 font-mono">{job.sku || job.captureId?.slice(-6) || '—'}</td>
                  <td className="px-2 py-1">{job.storeCandidate?.name || '—'}</td>
                  <td className="px-2 py-1">
                    <span className={`px-2 py-1 rounded-full font-bold ${statusBadge(job.status)}`}>{job.status}</span>
                  </td>
                  <td className="px-2 py-1">{job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}</td>
                  <td className="px-2 py-1 text-red-300">{job.parseError || ''}</td>
                  <td className="px-2 py-1">
                    {job.status === 'FAILED' ? (
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          void handleRetry(job);
                        }}
                        disabled={isRetrying === job.captureId}
                        className="text-[10px] font-bold uppercase tracking-widest text-ninpo-lime border border-ninpo-lime/40 px-2 py-1 rounded hover:bg-ninpo-lime/10 disabled:opacity-50"
                      >
                        {isRetrying === job.captureId ? 'Retrying…' : 'Retry'}
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              ))}

            </tbody>
          </table>
        </div>
      )}
      {/* Detail Modal */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-ninpo-midnight rounded-xl p-8 max-w-lg w-full border border-white/10 relative">
            <button className="absolute top-2 right-2 text-white text-xl" onClick={() => setSelectedJob(null)}>&times;</button>
            <h4 className="text-lg font-bold mb-2 text-ninpo-lime">Receipt Details</h4>
            <div className="text-xs text-slate-300 space-y-2">
              <div><b>SKU:</b> {selectedJob.sku || selectedJob.captureId?.slice(-6) || '—'}</div>
              <div><b>Store:</b> {selectedJob.storeCandidate?.name || '—'}</div>
              <div><b>Status:</b> <span className={`px-2 py-1 rounded-full font-bold ${statusBadge(selectedJob.status)}`}>{selectedJob.status}</span></div>
              <div><b>Created:</b> {selectedJob.createdAt ? new Date(selectedJob.createdAt).toLocaleString() : '—'}</div>
              {selectedJob.parseError && <div className="text-red-400"><b>Error:</b> {selectedJob.parseError}</div>}
              {Array.isArray(selectedJob.warnings) && selectedJob.warnings.length > 0 && (
                <div className="text-amber-400"><b>Warnings:</b> {selectedJob.warnings.join(', ')}</div>
              )}
              {selectedJob.items && Array.isArray(selectedJob.items) && (
                <div>
                  <b>Items:</b>
                  <ul className="list-disc ml-5">
                    {selectedJob.items.map((item: any, idx: number) => (
                      <li key={idx}>{item.name || item.label || 'Item'}{item.qty ? ` ×${item.qty}` : ''}{item.price ? ` — $${item.price}` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedJob.parseOutput && (
                <div>
                  <b>Parse Output:</b>
                  <pre className="bg-black/30 rounded p-2 mt-1 overflow-x-auto">{JSON.stringify(selectedJob.parseOutput, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Main dashboard component
const ManagementDashboard: React.FC = () => {
  // Receipt summary state
  const [receiptSummary, setReceiptSummary] = useState({
    parsedReceiptCount: 0,
    pendingReceiptCount: 0,
    parseReviewNeededCount: 0,
    parseCompletedCount: 0
  });
  const [isReceiptStatsLoading, setIsReceiptStatsLoading] = useState(false);
  const { addToast } = useNinpoCore();

  // Fetch summary from backend
  const fetchReceiptCaptureStats = async () => {
    setIsReceiptStatsLoading(true);
    try {
      const data = await apiFetch<{ summary?: any }>('/api/driver/receipt-captures-summary');
      const s = data?.summary || {};
      setReceiptSummary({
        parsedReceiptCount: s.parsed ?? 0,
        pendingReceiptCount: s.pendingParse ?? 0,
        parseReviewNeededCount: s.failed ?? 0,
        parseCompletedCount: s.committed ?? 0
      });
    } catch {
      addToast('Failed to refresh receipt stats', 'warning');
    } finally {
      setIsReceiptStatsLoading(false);
    }
  };
  useEffect(() => {
    fetchReceiptCaptureStats();
  }, []);

  // Listen for dashboard refresh event (auto-refresh after parse)
  useEffect(() => {
    function handleDashboardRefresh() {
      fetchReceiptCaptureStats();
    }
    window.addEventListener('ninpo:dashboard-refresh', handleDashboardRefresh);
    return () => {
      window.removeEventListener('ninpo:dashboard-refresh', handleDashboardRefresh);
    };
  }, []);

  // Analytics state
  const [events, setEvents] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Demand Forecast state
  const [forecast, setForecast] = useState<DemandForecastItem[]>([]);
  const [forecastInsights, setForecastInsights] = useState<string>('');
  const [isForecastLoading, setIsForecastLoading] = useState(false);

  const loadEvents = () => {
    setIsRefreshing(true);
    const storedEvents = analytics.getStoredEvents();
    setEvents(storedEvents);
    setTimeout(() => setIsRefreshing(false), 300);
  };

  useEffect(() => {
    loadEvents();
  }, []);

  const loadForecast = async () => {
    setIsForecastLoading(true);
    try {
      // Get products from events (simplified - in production, fetch from API)
      const productEvents = events.filter(e => e.category === 'product');
      const products = productEvents.map(e => ({
        id: e.metadata?.productId || '',
        name: e.label || 'Unknown'
      }));
      // orders is not defined in this context, so pass []
      const result = await getDemandForecast(products, [], 'week');
      setForecast(result.forecast.slice(0, 10)); // Top 10
      setForecastInsights(result.insights);
    } catch (error) {
      console.error('Forecast error:', error);
      setForecast([]);
      setForecastInsights('Unable to generate forecast');
    } finally {
      setIsForecastLoading(false);
    }
  };

  // Calculate analytics statistics
  const stats = useMemo(() => {
    const ordersCompleted = events.filter(e => e.action === 'order_completed').length;
    const totalOrderValue = events
      .filter(e => e.action === 'order_completed')
      .reduce((sum, e) => sum + (e.value || 0), 0);
    const avgOrderValue = ordersCompleted > 0 ? totalOrderValue / ordersCompleted : 0;
    const pageViews = events.filter(e => e.category === 'navigation' && e.action === 'page_view').length;
    const totalContainers = events
      .filter(e => e.action === 'return_completed')
      .reduce((sum, e) => sum + (e.value || 0), 0);
    return {
      total: events.length,
      ordersCompleted,
      totalOrderValue,
      avgOrderValue,
      pageViews,
      totalContainers
    };
  }, [events]);

  // Dummy audit model state for completeness (replace with real logic as needed)
  const [auditModel, setAuditModel] = useState('');
  const [auditModels, setAuditModels] = useState<string[]>([]);
  const [isAuditModelsLoading, setIsAuditModelsLoading] = useState(false);
  const [auditModelsError, setAuditModelsError] = useState<string | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<string | null>(null);
  const runAudit = () => {};

  // Main dashboard JSX
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black uppercase text-white tracking-wider">
            Dashboard
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Analytics • AI Insights • Error Monitoring
          </p>
        </div>
        <button
          onClick={loadEvents}
          disabled={isRefreshing}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold uppercase tracking-wide transition flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<BarChart3 className="h-4 w-4" />} label="Total Events" value={stats.total} />
        <StatCard icon={<Users className="h-4 w-4" />} label="Page Views" value={stats.pageViews} />
        <StatCard icon={<ShoppingCart className="h-4 w-4" />} label="Orders" value={stats.ordersCompleted} subtitle={`$${stats.avgOrderValue.toFixed(2)} avg`} />
        <StatCard icon={<Package className="h-4 w-4" />} label="Containers" value={stats.totalContainers} />
      </div>
      {/* Price Intelligence Summary (live data) */}
      <div className="flex items-center mb-2">
        <span className="text-lg font-bold text-white mr-4">Receipt Stats</span>
        <button
          onClick={fetchReceiptCaptureStats}
          disabled={isReceiptStatsLoading}
          className="flex items-center gap-2 px-3 py-1 rounded-lg bg-ninpo-lime text-ninpo-black font-bold text-xs uppercase tracking-widest hover:bg-ninpo-lime/90 transition"
        >
          <RefreshCw className={`w-4 h-4 ${isReceiptStatsLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
        {isReceiptStatsLoading && <span className="ml-3 text-xs text-slate-400">Updating…</span>}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <span className="text-[10px] text-slate-400 uppercase tracking-widest">Parsed Receipts</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl font-black text-white">{receiptSummary.parsedReceiptCount}</span>
            <span className="text-[10px] px-2 py-1 rounded-full bg-green-500/20 text-green-300 font-bold uppercase">Live</span>
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <span className="text-[10px] text-slate-400 uppercase tracking-widest">Pending Items</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl font-black text-white">{receiptSummary.parseReviewNeededCount}</span>
            <span className="text-[10px] px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-300 font-bold uppercase">Needs Review</span>
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <span className="text-[10px] text-slate-400 uppercase tracking-widest">Confirmed Items</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl font-black text-white">{receiptSummary.parseCompletedCount}</span>
            <span className="text-[10px] px-2 py-1 rounded-full bg-ninpo-lime/20 text-ninpo-lime font-bold uppercase">Committed</span>
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <span className="text-[10px] text-slate-400 uppercase tracking-widest">Queue Pending</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl font-black text-white">{receiptSummary.pendingReceiptCount}</span>
            <span className="text-[10px] px-2 py-1 rounded-full bg-blue-500/20 text-blue-300 font-bold uppercase">Queued</span>
          </div>
        </div>
      </div>
      {/* Parse Job History Panel */}
      <ParseJobHistoryPanel />
      {/* AI Operations Summary Section */}
      <div className="bg-white/5 rounded-xl p-6 border border-white/10">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">Audit Model</span>
            <select
              value={auditModel}
              onChange={event => setAuditModel(event.target.value)}
              disabled={isAuditModelsLoading || auditModels.length === 0}
              className="min-w-[180px] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-60"
            >
              {auditModels.length === 0 && (
                <option value="" disabled>{isAuditModelsLoading ? 'Loading models...' : 'No models'}</option>
              )}
              {auditModels.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
            {auditModelsError && (
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber-400">{auditModelsError}</span>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={runAudit}
              disabled={isAuditing || !auditModel}
              className="px-8 py-5 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 transition-all flex items-center gap-3"
            >
              <BrainCircuit className="w-4 h-4 text-ninpo-lime" />
              {isAuditing ? 'Auditing…' : 'Run Audit'}
            </button>
          </div>
        </div>
        {auditResult && (
          <div className="mt-4 p-4 bg-ninpo-midnight/60 rounded-lg border border-white/5">
            <pre className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{auditResult}</pre>
          </div>
        )}
      </div>
      {/* Error Monitor Section */}
      <ErrorMonitorPanel />
      {/* Demand Forecast Section */}
      <div className="bg-white/5 rounded-xl p-6 border border-white/10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-ninpo-lime" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Weekly Demand Forecast</h3>
          </div>
          <button
            onClick={loadForecast}
            disabled={isForecastLoading}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold uppercase tracking-wide transition flex items-center gap-2"
          >
            <RefreshCw className={`h-3 w-3 ${isForecastLoading ? 'animate-spin' : ''}`} />
            {isForecastLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        {forecastInsights && (
          <div className="mb-4 p-4 bg-ninpo-midnight/60 rounded-lg border border-white/5">
            <p className="text-xs text-slate-300 leading-relaxed">{forecastInsights}</p>
          </div>
        )}
        {isForecastLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-ninpo-lime" /></div>
        ) : forecast.length > 0 ? (
          <div className="space-y-2">
            {forecast.map((item, idx) => (
              <div key={idx} className="bg-ninpo-midnight/40 border border-white/5 rounded-lg p-3 flex items-center gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-ninpo-lime/10 flex items-center justify-center">
                  {item.trend === 'increasing' ? (
                    <TrendingUp className="w-4 h-4 text-green-400" />
                  ) : item.trend === 'decreasing' ? (
                    <TrendingDown className="w-4 h-4 text-red-400" />
                  ) : (
                    <Package className="w-4 h-4 text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{item.productName}</p>
                  <p className="text-xs text-slate-400">Predicted: {item.predictedSales} units • {item.confidence}% confidence</p>
                </div>
                <div className="flex-shrink-0">
                  <span className={`text-xs px-2 py-1 rounded-full ${item.stockRecommendation.toLowerCase().includes('ok') ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>{item.stockRecommendation}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500 text-center py-8">No forecast data available</p>
        )}
      </div>
    </div>
  );
};

export default ManagementDashboard;
