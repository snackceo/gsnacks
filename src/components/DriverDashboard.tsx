import React, { useEffect, useState } from 'react';
import {
  MapPin,
  Clock,
  TrendingUp,
  Package,
  Navigation2,
  CheckCircle2,
  AlertCircle,
  Zap,
  Eye
} from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

interface DriverDashboardProps {
  currentUser: any;
  onSelectOrder: (orderId: string) => void;
}

interface EarningsData {
  today: { deliveries: number; totalFees: number; totalDistance: number };
  week: { deliveries: number; totalFees: number; totalDistance: number };
  month: { deliveries: number; totalFees: number; totalDistance: number };
}

interface PerformanceData {
  thirtyDayStats: {
    completionRate: number;
    avgCompletionTimeMinutes: number;
    totalDeliveries: number;
    avgDeliveryDistance: number;
  };
}

interface AssignedOrder {
  id: string;
  orderId: string;
  status: string;
  address: string;
  total: number;
  estimatedTime: number;
  itemCount: number;
  customerId: string;
}

const DriverDashboard: React.FC<DriverDashboardProps> = ({ currentUser, onSelectOrder }) => {
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  const [performance, setPerformance] = useState<PerformanceData | null>(null);
  const [assignedOrders, setAssignedOrders] = useState<AssignedOrder[]>([]);
  const [pendingOrders, setPendingOrders] = useState<AssignedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const completionRate = Math.round((performance?.thirtyDayStats?.completionRate || 0) * 100);
  const avgTime = performance?.thirtyDayStats?.avgCompletionTimeMinutes || 0;
  const avgDistance = performance?.thirtyDayStats?.avgDeliveryDistance || 0;
  const deliveriesPerDay = Math.max(0, Math.round((performance?.thirtyDayStats?.totalDeliveries || 0) / 30));
  const onTimePace = avgTime ? Math.min(100, Math.round((45 / avgTime) * 100)) : 100;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const token = localStorage.getItem('token');

        const [earningsRes, perfRes, assignedRes, pendingRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/driver/earnings`, {
            headers: { Authorization: `Bearer ${token}` }
          }),
          fetch(`${BACKEND_URL}/api/driver/performance`, {
            headers: { Authorization: `Bearer ${token}` }
          }),
          fetch(`${BACKEND_URL}/api/driver/assigned-orders`, {
            headers: { Authorization: `Bearer ${token}` }
          }),
          fetch(`${BACKEND_URL}/api/driver/pending-orders`, {
            headers: { Authorization: `Bearer ${token}` }
          })
        ]);

        if (earningsRes.ok) {
          const data = await earningsRes.json();
          setEarnings((data as any)?.ok ? (data as EarningsData) : (data as EarningsData));
        }
        if (perfRes.ok) {
          const data = await perfRes.json();
          setPerformance((data as any)?.ok ? (data as PerformanceData) : (data as PerformanceData));
        }
        if (assignedRes.ok) {
          const data = await assignedRes.json();
          setAssignedOrders(data.orders || []);
        }
        if (pendingRes.ok) {
          const data = await pendingRes.json();
          setPendingOrders(data.orders || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-ninpo-black text-white">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-ninpo-lime border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p>Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ninpo-black text-white p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-black text-ninpo-lime mb-2">Driver Dashboard</h1>
          <p className="text-white/60">Welcome back, {currentUser?.username || 'Driver'}</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-600 rounded-xl text-red-300 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gradient-to-br from-ninpo-lime/20 to-ninpo-lime/5 border border-ninpo-lime/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-ninpo-lime" />
              <span className="text-xs font-bold text-ninpo-lime uppercase">Today</span>
            </div>
            <p className="text-2xl font-black">${earnings?.today?.totalFees?.toFixed(2) || '0.00'}</p>
            <p className="text-xs text-white/50">{earnings?.today?.deliveries || 0} deliveries</p>
          </div>

          <div className="bg-gradient-to-br from-blue-500/20 to-blue-500/5 border border-blue-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold text-blue-400 uppercase">Week</span>
            </div>
            <p className="text-2xl font-black">${earnings?.week?.totalFees?.toFixed(2) || '0.00'}</p>
            <p className="text-xs text-white/50">{earnings?.week?.deliveries || 0} deliveries</p>
          </div>

          <div className="bg-gradient-to-br from-purple-500/20 to-purple-500/5 border border-purple-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-bold text-purple-400 uppercase">Distance</span>
            </div>
            <p className="text-2xl font-black">{earnings?.today?.totalDistance?.toFixed(1) || '0'} mi</p>
            <p className="text-xs text-white/50">today</p>
          </div>

          <div className="bg-gradient-to-br from-green-500/20 to-green-500/5 border border-green-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-green-400" />
              <span className="text-xs font-bold text-green-400 uppercase">Avg Time</span>
            </div>
            <p className="text-2xl font-black">{performance?.thirtyDayStats?.avgCompletionTimeMinutes || 0} min</p>
            <p className="text-xs text-white/50">per delivery</p>
          </div>
        </div>

        {/* Orders Grid */}
        <div className="grid md:grid-cols-2 gap-8">
          {/* Assigned Orders */}
          <div>
            <h2 className="text-xl font-black text-ninpo-lime mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              My Assigned Orders ({assignedOrders.length})
            </h2>
            <div className="space-y-3">
              {assignedOrders.length > 0 ? (
                assignedOrders.map((order) => (
                  <div
                    key={order.id}
                    className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 hover:border-ninpo-lime/50 transition-all"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="text-sm font-black text-ninpo-lime">Order {order.orderId?.slice(0, 8)}</p>
                        <p className="text-xs text-white/50 mt-1 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {order.address?.slice(0, 40)}...
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-black text-white">${order.total?.toFixed(2)}</p>
                        <p className="text-xs text-white/50">{order.itemCount} items</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                        order.status === 'ASSIGNED'
                          ? 'bg-blue-500/30 text-blue-300'
                          : order.status === 'PICKED_UP'
                          ? 'bg-purple-500/30 text-purple-300'
                          : 'bg-green-500/30 text-green-300'
                      }`}>
                        {order.status}
                      </span>
                      <span className="text-xs text-white/50 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        ~{order.estimatedTime}m
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => onSelectOrder(order.orderId)}
                        className="flex-1 py-2 bg-ninpo-lime text-ninpo-black rounded-lg font-bold text-sm hover:bg-white transition-all"
                      >
                        Start Delivery
                      </button>
                      <button
                        onClick={() => onSelectOrder(`detail-${order.orderId}`)}
                        className="py-2 px-3 bg-white/10 text-white rounded-lg font-bold text-sm hover:bg-white/20 transition-all flex items-center gap-1"
                      >
                        <Eye className="w-4 h-4" />
                        Details
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center">
                  <Package className="w-8 h-8 text-white/30 mx-auto mb-3" />
                  <p className="text-white/50">No assigned orders</p>
                </div>
              )}
            </div>
          </div>

          {/* Pending Orders (Browse Available) */}
          <div>
            <h2 className="text-xl font-black text-white mb-4 flex items-center gap-2">
              <Navigation2 className="w-5 h-5" />
              Available Orders ({pendingOrders.length})
            </h2>
            <div className="space-y-3">
              {pendingOrders.length > 0 ? (
                pendingOrders.slice(0, 5).map((order) => (
                  <div
                    key={order.id}
                    className="bg-white/5 border border-white/10 rounded-xl p-4 hover:border-ninpo-lime/50 transition-all"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-bold text-white">Order {order.orderId?.slice(0, 8)}</p>
                        <p className="text-xs text-white/50 mt-1 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {order.address?.slice(0, 40)}...
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-black text-ninpo-lime">${order.total?.toFixed(2)}</p>
                        <p className="text-xs text-white/50">{order.itemCount} items</p>
                      </div>
                    </div>
                    <button
                      onClick={() => onSelectOrder(order.orderId)}
                      className="w-full mt-3 py-2 bg-ninpo-lime text-ninpo-black rounded-lg text-xs font-black uppercase hover:bg-white transition-all"
                    >
                      Accept Order
                    </button>
                  </div>
                ))
              ) : (
                <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center">
                  <AlertCircle className="w-8 h-8 text-white/30 mx-auto mb-3" />
                  <p className="text-white/50">No pending orders available</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Performance Metrics */}
        {performance && (
          <div className="mt-8 bg-white/5 border border-white/10 rounded-xl p-6">
            <h2 className="text-xl font-black text-ninpo-lime mb-4">30-Day Performance</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-black/40 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-white/60 uppercase font-bold mb-2">Completion Rate</p>
                <p className="text-2xl font-black text-ninpo-lime">{completionRate}%</p>
                <div className="mt-2 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-ninpo-lime" style={{ width: `${completionRate}%` }} />
                </div>
              </div>
              <div className="bg-black/40 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-white/60 uppercase font-bold mb-2">On-Time Pace</p>
                <p className="text-2xl font-black text-white">{avgTime.toFixed(1)} min</p>
                <div className="mt-2 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400" style={{ width: `${Math.min(100, onTimePace)}%` }} />
                </div>
                <p className="text-xs text-white/50 mt-1">Target under 45 min</p>
              </div>
              <div className="bg-black/40 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-white/60 uppercase font-bold mb-2">Avg Distance</p>
                <p className="text-2xl font-black text-white">{avgDistance.toFixed(1)} mi</p>
                <p className="text-xs text-white/50 mt-1">Optimize route batching</p>
              </div>
              <div className="bg-black/40 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-white/60 uppercase font-bold mb-2">Deliveries / Day</p>
                <p className="text-2xl font-black text-white">{deliveriesPerDay}</p>
                <p className="text-xs text-white/50 mt-1">{performance.thirtyDayStats.totalDeliveries} last 30 days</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-ninpo-lime/10 border border-ninpo-lime/40 rounded-lg p-4">
                <p className="text-xs uppercase text-ninpo-lime font-bold mb-1">Earnings Momentum</p>
                <p className="text-lg font-black text-white">${earnings?.week?.totalFees?.toFixed(2) || '0.00'} this week</p>
                <p className="text-xs text-white/60">${earnings?.month?.totalFees?.toFixed(2) || '0.00'} month-to-date</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <p className="text-xs uppercase text-white/60 font-bold mb-1">Focus</p>
                <p className="text-sm text-white/80">Keep completion above 95% and on-time under 45 min for priority batches.</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <p className="text-xs uppercase text-white/60 font-bold mb-1">Routing Tips</p>
                <p className="text-sm text-white/80">Group nearby orders and use live navigation to reduce distance per drop.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DriverDashboard;
