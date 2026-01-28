import React, { useState, useEffect, useMemo } from 'react';
// Defensive helper for stats fields
function safeStat(capture, key) {
  return capture && capture.stats && typeof capture.stats[key] === 'number' ? capture.stats[key] : 0;
}

const ManagementDashboard: React.FC<ManagementDashboardProps> = ({
  auditModel,
  auditModels,
  auditModelsError,
  isAuditModelsLoading,
  isAuditing,
  isOpsSummaryLoading,
  orders,
  aiInsights,
  opsSummary,
  chartData,
  isChartReady,
  isChartVisible,
  chartContainerRef,
  setAuditModel,
  runAudit,
  runOpsSummary
}) => {
  // Receipt summary state for price intelligence
  const [receiptSummary, setReceiptSummary] = useState({
    parsedReceiptCount: 0,
    pendingReceiptCount: 0,
    parseReviewNeededCount: 0,
    parseCompletedCount: 0
  });

  useEffect(() => {
    // Fetch summary from backend (same as fetchReceiptCaptureStats in PricingIntelligence)
    async function fetchReceiptCaptureStats() {
      try {
        const resp = await fetch('/api/receipts-captures-summary', { credentials: 'include' });
        if (!resp.ok) return;
        const data = await resp.json();
        setReceiptSummary({
          parsedReceiptCount: data.parsedReceiptCount ?? 0,
          pendingReceiptCount: data.pendingReceiptCount ?? 0,
          parseReviewNeededCount: data.parseReviewNeededCount ?? 0,
          parseCompletedCount: data.parseCompletedCount ?? 0
        });
      } catch {
        // fail silently for dashboard
      }
    }
    fetchReceiptCaptureStats();
  }, []);
import { ErrorMonitorPanel } from './ErrorMonitorPanel';
import { BarChart3, ShieldAlert, Loader2, BrainCircuit, TrendingUp, Users, ShoppingCart, Package, RefreshCw, TrendingDown, Sparkles } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Order } from '../../types';
import { analytics } from '../../services/analyticsService';
import { getDemandForecast, DemandForecastItem } from '../../services/geminiService';

interface AnalyticsEvent {
  category: 'user' | 'product' | 'order' | 'scanner' | 'returns' | 'payment' | 'navigation';
  action: string;
  label?: string;
  value?: number;
  metadata?: Record<string, any>;
  timestamp: string;
}

interface ManagementDashboardProps {
  auditModel: string;
  auditModels: string[];
  auditModelsError: string | null;
  isAuditModelsLoading: boolean;
  isAuditing: boolean;
  isOpsSummaryLoading: boolean;
  orders: Order[];
  aiInsights: string | null;
  opsSummary: string;
  chartData: any[];
  isChartReady: boolean;
  isChartVisible: boolean;
  chartContainerRef: React.RefObject<HTMLDivElement>;
  setAuditModel: (model: string) => void;
  runAudit?: () => void;
  runOpsSummary: () => void;
}

// StatCard component
const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  subtitle?: string;
}> = ({ icon, label, value, subtitle }) => (
  <div className="bg-white/5 rounded-xl p-4 border border-white/10">
    <div className="flex items-center gap-2 mb-2">
      <div className="text-ninpo-lime">{icon}</div>
      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
        {label}
      </span>
    </div>
    <div className="text-2xl font-black text-white">{value}</div>
    {subtitle && (
      <div className="text-xs text-slate-500 mt-1">{subtitle}</div>
    )}
  </div>
);

const ManagementDashboard: React.FC<ManagementDashboardProps> = ({
  auditModel,
  auditModels,
  auditModelsError,
  isAuditModelsLoading,
  isAuditing,
  isOpsSummaryLoading,
  orders,
  aiInsights,
  opsSummary,
  chartData,
  isChartReady,
  isChartVisible,
  chartContainerRef,
  setAuditModel,
  runAudit,
  runOpsSummary
}) => {
  // Analytics state
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
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

      const result = await getDemandForecast(products, orders, 'week');
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
        <StatCard
          icon={<BarChart3 className="h-4 w-4" />}
          label="Total Events"
          value={stats.total}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Page Views"
          value={stats.pageViews}
        />
        <StatCard
          icon={<ShoppingCart className="h-4 w-4" />}
          label="Orders"
          value={stats.ordersCompleted}
          subtitle={`$${stats.avgOrderValue.toFixed(2)} avg`}
        />
        <StatCard
          icon={<Package className="h-4 w-4" />}
          label="Containers"
          value={stats.totalContainers}
        />
      </div>

      {/* Price Intelligence Summary (live data) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <span className="text-[10px] text-slate-400 uppercase tracking-widest">Parsed Receipts</span>
          <div className="text-2xl font-black text-white mt-1">{receiptSummary.parsedReceiptCount}</div>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <span className="text-[10px] text-slate-400 uppercase tracking-widest">Pending Items</span>
          <div className="text-2xl font-black text-white mt-1">{receiptSummary.parseReviewNeededCount}</div>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <span className="text-[10px] text-slate-400 uppercase tracking-widest">Confirmed Items</span>
          <div className="text-2xl font-black text-white mt-1">{receiptSummary.parseCompletedCount}</div>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <span className="text-[10px] text-slate-400 uppercase tracking-widest">Queue Pending</span>
          <div className="text-2xl font-black text-white mt-1">{receiptSummary.pendingReceiptCount}</div>
        </div>
      </div>

      {/* AI Operations Summary Section */}
      <div className="bg-white/5 rounded-xl p-6 border border-white/10">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
              Audit Model
            </span>
            <select
              value={auditModel}
              onChange={event => setAuditModel(event.target.value)}
              disabled={isAuditModelsLoading || auditModels.length === 0}
              className="min-w-[180px] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-60"
            >
              {auditModels.length === 0 && (
                <option value="" disabled>
                  {isAuditModelsLoading ? 'Loading models...' : 'No models'}
                </option>
              )}
              {auditModels.map(model => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            {auditModelsError && (
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber-400">
                {auditModelsError}
              </span>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={runAudit}
              disabled={isAuditing || !auditModel}
              className="px-8 py-5 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 transition-all flex items-center gap-3"
            >
              {isAuditing ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <BrainCircuit className="w-6 h-6" />
              )}
              Analyze Inventory
            </button>
            <button
              onClick={runOpsSummary}
              disabled={isOpsSummaryLoading || orders.length === 0}
              className="px-8 py-5 rounded-2xl bg-ninpo-lime/10 border border-ninpo-lime/20 text-[10px] font-black uppercase tracking-widest text-ninpo-lime hover:bg-ninpo-lime/20 transition-all flex items-center gap-3 disabled:opacity-60"
            >
              {isOpsSummaryLoading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <BarChart3 className="w-6 h-6" />
              )}
              Daily Operations Report
            </button>
          </div>
        </div>
      </div>

      {aiInsights && (
        <div className="bg-ninpo-midnight p-8 rounded-[2rem] border border-ninpo-lime/20 text-xs text-slate-300 leading-relaxed shadow-xl whitespace-pre-wrap">
          <p className="font-black text-ninpo-lime uppercase mb-4 tracking-widest flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> Inventory Analysis
          </p>
          {aiInsights}
        </div>
      )}

      {opsSummary && (
        <div className="bg-ninpo-midnight/60 p-8 rounded-[2rem] border border-white/10 text-xs text-slate-300 leading-relaxed shadow-xl whitespace-pre-wrap">
          <p className="font-black text-white uppercase mb-4 tracking-widest flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Daily Operations Report
          </p>
          {opsSummary}
        </div>
      )}

      <div
        ref={chartContainerRef}
        className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5 h-80 min-h-[320px]"
      >
        {isChartReady && isChartVisible ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#222" />
              <XAxis dataKey="name" stroke="#555" fontSize={9} />
              <YAxis stroke="#555" fontSize={9} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111',
                  border: 'none',
                  borderRadius: '1rem',
                  fontSize: '10px'
                }}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#00ff41"
                strokeWidth={3}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Loading chart…
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
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              Weekly Demand Forecast
            </h3>
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
            <p className="text-xs text-slate-300 leading-relaxed">
              {forecastInsights}
            </p>
          </div>
        )}

        {isForecastLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-ninpo-lime" />
          </div>
        ) : forecast.length > 0 ? (
          <div className="space-y-2">
            {forecast.map((item, idx) => (
              <div
                key={idx}
                className="bg-ninpo-midnight/40 border border-white/5 rounded-lg p-3 flex items-center gap-4"
              >
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
                  <p className="text-sm font-bold text-white truncate">
                    {item.productName}
                  </p>
                  <p className="text-xs text-slate-400">
                    Predicted: {item.predictedSales} units • {item.confidence}% confidence
                  </p>
                </div>

                <div className="flex-shrink-0">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    item.stockRecommendation.toLowerCase().includes('ok')
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-yellow-500/10 text-yellow-400'
                  }`}>
                    {item.stockRecommendation}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500 text-center py-8">
            No forecast data available
          </p>
        )}
      </div>
    </div>
  );
};

export default ManagementDashboard;
