import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  Star,
  Clock,
  Zap,
  Target,
  AlertCircle,
  Loader2,
  Award
} from 'lucide-react';

interface PerformanceMetrics {
  thirtyDayStats: {
    completionRate: number;
    avgCompletionTimeMinutes: number;
    totalDeliveries: number;
    avgDeliveryDistance: number;
  };
  averageRating: number;
  onTimePercentage: number;
  customerSatisfaction: number;
  rank?: string;
}

interface DriverPerformanceDashboardProps {
  driverId?: string;
}

const DriverPerformanceDashboard: React.FC<DriverPerformanceDashboardProps> = ({ driverId }) => {
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPerformance();
  }, [driverId]);

  const fetchPerformance = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:5000/api/driver/performance', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        setPerformance(data.performance);
      } else {
        setError('Failed to load performance metrics');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading performance');
    } finally {
      setLoading(false);
    }
  };

  const getRankBadge = (rating: number) => {
    if (rating >= 4.8) return { label: 'Platinum', color: 'bg-purple-500/20 border-purple-500/50 text-purple-300' };
    if (rating >= 4.5) return { label: 'Gold', color: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300' };
    if (rating >= 4.0) return { label: 'Silver', color: 'bg-gray-500/20 border-gray-500/50 text-gray-300' };
    return { label: 'Bronze', color: 'bg-orange-500/20 border-orange-500/50 text-orange-300' };
  };

  const getPerformanceGrade = (percentage: number): string => {
    if (percentage >= 95) return 'A+';
    if (percentage >= 90) return 'A';
    if (percentage >= 85) return 'B+';
    if (percentage >= 80) return 'B';
    return 'C';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-ninpo-lime" />
      </div>
    );
  }

  if (error || !performance) {
    return (
      <div className="p-6 bg-red-900/20 border border-red-600 rounded-xl text-red-300 flex items-center gap-2">
        <AlertCircle className="w-5 h-5" />
        {error || 'Failed to load performance data'}
      </div>
    );
  }

  const stats = performance.thirtyDayStats;
  const rankBadge = getRankBadge(performance.averageRating);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-ninpo-lime/20 to-ninpo-lime/5 border border-ninpo-lime/30 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-black text-ninpo-lime">30-Day Performance</h2>
          <Award className="w-8 h-8 text-ninpo-lime" />
        </div>
        <div className="grid grid-cols-4 gap-4">
          {/* Rating Badge */}
          <div className="text-center">
            <div className="flex justify-center mb-2">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  className={`w-5 h-5 ${
                    i < Math.floor(performance.averageRating)
                      ? 'text-yellow-400 fill-yellow-400'
                      : 'text-white/30'
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-white/60">Rating</p>
            <p className="font-black text-ninpo-lime">{performance.averageRating.toFixed(1)}</p>
          </div>

          {/* Rank */}
          <div className="text-center">
            <div className={`inline-block px-3 py-2 rounded-lg border ${rankBadge.color} mb-2 font-bold text-sm`}>
              {rankBadge.label}
            </div>
            <p className="text-xs text-white/60 mt-2">Tier</p>
          </div>

          {/* On-Time */}
          <div className="text-center">
            <div className="text-3xl font-black text-green-400 mb-2">{performance.onTimePercentage}%</div>
            <p className="text-xs text-white/60">On-Time</p>
          </div>

          {/* Grade */}
          <div className="text-center">
            <div className="text-3xl font-black text-ninpo-lime mb-2">{getPerformanceGrade(performance.onTimePercentage)}</div>
            <p className="text-xs text-white/60">Grade</p>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-4">
        {/* Total Deliveries */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-white/70">Total Deliveries</p>
            <Zap className="w-5 h-5 text-ninpo-lime" />
          </div>
          <p className="text-3xl font-black text-ninpo-lime">{stats.totalDeliveries}</p>
          <p className="text-xs text-white/50 mt-2">orders completed</p>
        </div>

        {/* Completion Rate */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-white/70">Completion Rate</p>
            <Target className="w-5 h-5 text-ninpo-lime" />
          </div>
          <p className="text-3xl font-black text-green-400">{stats.completionRate}%</p>
          <p className="text-xs text-white/50 mt-2">of assigned orders</p>
        </div>

        {/* Avg Delivery Time */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-white/70">Avg Delivery Time</p>
            <Clock className="w-5 h-5 text-ninpo-lime" />
          </div>
          <p className="text-3xl font-black text-white">{Math.round(stats.avgCompletionTimeMinutes)}</p>
          <p className="text-xs text-white/50 mt-2">minutes per delivery</p>
        </div>

        {/* Avg Distance */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-white/70">Avg Distance</p>
            <TrendingUp className="w-5 h-5 text-ninpo-lime" />
          </div>
          <p className="text-3xl font-black text-white">{stats.avgDeliveryDistance.toFixed(1)}</p>
          <p className="text-xs text-white/50 mt-2">km per delivery</p>
        </div>
      </div>

      {/* Customer Satisfaction */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <p className="text-sm font-bold text-white/70 mb-4">Customer Satisfaction</p>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm">Overall Score</span>
              <span className="font-black text-ninpo-lime">{performance.customerSatisfaction}%</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-ninpo-lime to-green-400 h-full rounded-full transition-all"
                style={{ width: `${performance.customerSatisfaction}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Performance Tips */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <h3 className="font-bold text-white mb-3 flex items-center gap-2">
          <Target className="w-4 h-4 text-ninpo-lime" />
          Performance Tips
        </h3>
        <ul className="space-y-2 text-sm text-white/70">
          <li className="flex gap-2">
            <span className="text-ninpo-lime">•</span>
            Keep your completion rate above 95% to maintain platinum status
          </li>
          <li className="flex gap-2">
            <span className="text-ninpo-lime">•</span>
            Improve on-time deliveries to unlock bonuses and incentives
          </li>
          <li className="flex gap-2">
            <span className="text-ninpo-lime">•</span>
            Request customer signatures for proof and higher satisfaction
          </li>
          <li className="flex gap-2">
            <span className="text-ninpo-lime">•</span>
            Maintain professional communication during deliveries
          </li>
        </ul>
      </div>

      {/* Refresh Button */}
      <button
        onClick={fetchPerformance}
        className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl font-black uppercase tracking-widest transition-all"
      >
        Refresh Metrics
      </button>
    </div>
  );
};

export default DriverPerformanceDashboard;
