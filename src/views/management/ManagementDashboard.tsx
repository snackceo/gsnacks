import React from 'react';
import { ErrorMonitorPanel } from './ErrorMonitorPanel';
import { BarChart3, ShieldAlert, Loader2, BrainCircuit } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Order } from '../../types';

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
  runAudit: () => void;
  runOpsSummary: () => void;
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
  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <h2 className="text-xl font-black uppercase text-white tracking-widest">
            Main Dashboard
          </h2>
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
            Revenue snapshots & operational pulse
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
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
              Run Audit
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
              Ops Summary
            </button>
          </div>
        </div>
      </div>

      {aiInsights && (
        <div className="bg-ninpo-midnight p-8 rounded-[2rem] border border-ninpo-lime/20 text-xs text-slate-300 leading-relaxed shadow-xl whitespace-pre-wrap">
          <p className="font-black text-ninpo-lime uppercase mb-4 tracking-widest flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> Audit Report
          </p>
          {aiInsights}
        </div>
      )}

      {opsSummary && (
        <div className="bg-ninpo-midnight/60 p-8 rounded-[2rem] border border-white/10 text-xs text-slate-300 leading-relaxed shadow-xl whitespace-pre-wrap">
          <p className="font-black text-white uppercase mb-4 tracking-widest flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Ops Summary
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
    </div>
  );
};

export default ManagementDashboard;
