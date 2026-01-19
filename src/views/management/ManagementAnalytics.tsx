// src/views/management/ManagementAnalytics.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Users, ShoppingCart, Package, BarChart3, RefreshCw } from 'lucide-react';
import { analytics } from '../../services/analyticsService';

interface AnalyticsEvent {
  category: 'user' | 'product' | 'order' | 'scanner' | 'returns' | 'payment' | 'navigation';
  action: string;
  label?: string;
  value?: number;
  metadata?: Record<string, any>;
  timestamp: string;
}

export default function ManagementAnalytics() {
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadEvents = () => {
    setIsRefreshing(true);
    const storedEvents = analytics.getStoredEvents();
    setEvents(storedEvents);
    setTimeout(() => setIsRefreshing(false), 300);
  };

  useEffect(() => {
    loadEvents();
  }, []);

  // Calculate statistics
  const stats = useMemo(() => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const recentEvents = events.filter(e => new Date(e.timestamp).getTime() > oneDayAgo);
    const weekEvents = events.filter(e => new Date(e.timestamp).getTime() > oneWeekAgo);

    // Count by category
    const categoryCounts: Record<string, number> = {};
    events.forEach(e => {
      categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
    });

    // Product interactions
    const productViews = events.filter(e => e.action === 'view').length;
    const addToCarts = events.filter(e => e.action === 'add_to_cart').length;
    const conversionRate = productViews > 0 ? (addToCarts / productViews) * 100 : 0;

    // Orders
    const ordersCompleted = events.filter(e => e.action === 'order_completed').length;
    const ordersFailed = events.filter(e => e.action === 'order_failed').length;
    const totalOrderValue = events
      .filter(e => e.action === 'order_completed')
      .reduce((sum, e) => sum + (e.value || 0), 0);
    const avgOrderValue = ordersCompleted > 0 ? totalOrderValue / ordersCompleted : 0;

    // Scanner usage
    const scannerOpened = events.filter(e => e.action === 'scanner_opened').length;
    const scannerScans = events.filter(e => e.action === 'scanner_scanned').length;

    // Returns
    const returnsCompleted = events.filter(e => e.action === 'return_completed').length;
    const totalContainers = events
      .filter(e => e.action === 'return_completed')
      .reduce((sum, e) => sum + (e.value || 0), 0);

    // Page views
    const pageViews = events.filter(e => e.category === 'navigation' && e.action === 'page_view').length;
    const uniquePages = new Set(
      events
        .filter(e => e.category === 'navigation' && e.action === 'page_view')
        .map(e => e.label)
    ).size;

    return {
      total: events.length,
      last24h: recentEvents.length,
      lastWeek: weekEvents.length,
      categoryCounts,
      productViews,
      addToCarts,
      conversionRate,
      ordersCompleted,
      ordersFailed,
      totalOrderValue,
      avgOrderValue,
      scannerOpened,
      scannerScans,
      returnsCompleted,
      totalContainers,
      pageViews,
      uniquePages
    };
  }, [events]);

  const handleClearEvents = () => {
    if (confirm('Clear all analytics data? This cannot be undone.')) {
      analytics.clearStoredEvents();
      loadEvents();
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Analytics Dashboard</h2>
          <p className="text-sm text-white/60 mt-1">
            Local event tracking • {events.length} total events
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadEvents}
            disabled={isRefreshing}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleClearEvents}
            className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm font-medium transition"
          >
            Clear Data
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<BarChart3 className="h-5 w-5" />}
          label="Total Events"
          value={stats.total}
          subtitle={`${stats.last24h} in last 24h`}
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Page Views"
          value={stats.pageViews}
          subtitle={`${stats.uniquePages} unique pages`}
        />
        <StatCard
          icon={<ShoppingCart className="h-5 w-5" />}
          label="Orders Completed"
          value={stats.ordersCompleted}
          subtitle={`$${stats.avgOrderValue.toFixed(2)} avg value`}
        />
        <StatCard
          icon={<Package className="h-5 w-5" />}
          label="Containers Returned"
          value={stats.totalContainers}
          subtitle={`${stats.returnsCompleted} returns`}
        />
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Product Metrics */}
        <div className="bg-white/5 rounded-lg p-6 border border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-400" />
            Product Metrics
          </h3>
          <div className="space-y-3">
            <MetricRow label="Product Views" value={stats.productViews} />
            <MetricRow label="Add to Cart" value={stats.addToCarts} />
            <MetricRow
              label="Conversion Rate"
              value={`${stats.conversionRate.toFixed(1)}%`}
            />
          </div>
        </div>

        {/* Order Metrics */}
        <div className="bg-white/5 rounded-lg p-6 border border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-blue-400" />
            Order Metrics
          </h3>
          <div className="space-y-3">
            <MetricRow label="Completed Orders" value={stats.ordersCompleted} />
            <MetricRow label="Failed Orders" value={stats.ordersFailed} />
            <MetricRow
              label="Total Revenue"
              value={`$${stats.totalOrderValue.toFixed(2)}`}
            />
            <MetricRow
              label="Average Order"
              value={`$${stats.avgOrderValue.toFixed(2)}`}
            />
          </div>
        </div>

        {/* Scanner Metrics */}
        <div className="bg-white/5 rounded-lg p-6 border border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Package className="h-5 w-5 text-purple-400" />
            Scanner Usage
          </h3>
          <div className="space-y-3">
            <MetricRow label="Scanner Opens" value={stats.scannerOpened} />
            <MetricRow label="Total Scans" value={stats.scannerScans} />
            <MetricRow
              label="Scans per Session"
              value={
                stats.scannerOpened > 0
                  ? (stats.scannerScans / stats.scannerOpened).toFixed(1)
                  : '0'
              }
            />
          </div>
        </div>

        {/* Event Categories */}
        <div className="bg-white/5 rounded-lg p-6 border border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4">Event Categories</h3>
          <div className="space-y-3">
            {Object.entries(stats.categoryCounts)
              .sort(([, a], [, b]) => Number(b) - Number(a))
              .map(([category, count], idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-white/60">{category}</span>
                  <span className="text-white font-semibold">{Number(count)}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Recent Events */}
      <div className="bg-white/5 rounded-lg p-6 border border-white/10">
        <h3 className="text-lg font-semibold text-white mb-4">Recent Events</h3>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {events.slice(0, 20).map((event, idx) => (
            <div
              key={idx}
              className="flex items-start justify-between p-3 bg-white/5 rounded border border-white/10 text-sm"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">
                    {event.category}
                  </span>
                  <span className="text-white font-medium">{event.action}</span>
                  {event.label && (
                    <span className="text-white/60">• {event.label}</span>
                  )}
                </div>
                {event.value !== undefined && (
                  <div className="text-white/40 mt-1">Value: {event.value}</div>
                )}
              </div>
              <div className="text-white/40 text-xs whitespace-nowrap ml-4">
                {new Date(event.timestamp).toLocaleString()}
              </div>
            </div>
          ))}
          {events.length === 0 && (
            <div className="text-center text-white/40 py-8">
              No events tracked yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper Components
function StatCard({
  icon,
  label,
  value,
  subtitle
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  subtitle?: string;
}) {
  return (
    <div className="bg-white/5 rounded-lg p-6 border border-white/10">
      <div className="flex items-center gap-3 mb-2">
        <div className="text-white/60">{icon}</div>
        <div className="text-sm text-white/60 uppercase tracking-wide">{label}</div>
      </div>
      <div className="text-3xl font-bold text-white">{value}</div>
      {subtitle && <div className="text-sm text-white/40 mt-1">{subtitle}</div>}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/60">{label}</span>
      <span className="text-white font-semibold">{value}</span>
    </div>
  );
}

