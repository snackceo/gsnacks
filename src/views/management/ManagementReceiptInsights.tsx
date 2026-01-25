import React from 'react';
import { Loader2, X } from 'lucide-react';
import { StoreRecord } from '../../types';

// Local interface for noise rules (matches useReceiptAliases hook)
interface NoiseRuleEntry {
  id: string;
  normalizedName: string;
  rawNames?: { name: string; firstSeen?: string; occurrences?: number }[];
  lastSeenAt?: string;
}

interface AliasConfidenceSummary {
  safeCount: number;
  gatedCount: number;
  averageEffective: number;
}

interface ManagementReceiptInsightsProps {
  aliasConfidenceSummary: AliasConfidenceSummary;
  showNoiseRules: boolean;
  onToggleNoiseRules: (show: boolean) => void;
  noiseRules: NoiseRuleEntry[];
  isLoadingNoiseRules: boolean;
  activeStore: StoreRecord | null;
  onDeleteNoiseRule: (ruleId: string) => Promise<void>;
}

/**
 * ManagementReceiptInsights
 * 
 * Card displaying alias confidence metrics and modal for noise rules management.
 * Separated from main ManagementPricingIntelligence to reduce component complexity.
 */
const ManagementReceiptInsights: React.FC<ManagementReceiptInsightsProps> = ({
  aliasConfidenceSummary,
  showNoiseRules,
  onToggleNoiseRules,
  noiseRules,
  isLoadingNoiseRules,
  activeStore,
  onDeleteNoiseRule
}) => {
  return (
    <>
      {/* Receipt Insights Card */}
      <div className="bg-gradient-to-r from-emerald-900 to-emerald-800 rounded-2xl p-6 border border-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-black uppercase text-white tracking-widest">Receipt Insights</h3>
            <p className="text-xs text-emerald-200 mt-2">Review alias confidence and drift alerts.</p>
          </div>
          <button
            onClick={() => onToggleNoiseRules(true)}
            className="text-[10px] uppercase tracking-widest font-black text-emerald-200 border border-emerald-300/40 rounded-full px-3 py-2 hover:bg-emerald-500/20"
          >
            Noise Rules
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="bg-white/10 rounded-xl p-3 text-white">
            <p className="text-[10px] uppercase tracking-widest text-emerald-200">Alias Confidence</p>
            <p className="text-sm font-semibold">
              {aliasConfidenceSummary.safeCount} safe / {aliasConfidenceSummary.gatedCount} gated
            </p>
          </div>
          <div className="bg-white/10 rounded-xl p-3 text-white">
            <p className="text-[10px] uppercase tracking-widest text-emerald-200">Avg Confidence</p>
            <p className="text-sm font-semibold">{(aliasConfidenceSummary.averageEffective * 100).toFixed(0)}%</p>
          </div>
        </div>
      </div>

      {/* Noise Rules Modal */}
      {showNoiseRules && (
        <div className="fixed inset-0 z-50 bg-ninpo-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-ninpo-card rounded-[2rem] border border-white/10 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-white font-black uppercase text-sm tracking-widest">Noise Rules</h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">Store: {activeStore?.name}</p>
              </div>
              <button
                onClick={() => onToggleNoiseRules(false)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isLoadingNoiseRules ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading noise rules…
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-2">
                {noiseRules.length === 0 ? (
                  <p className="text-xs text-slate-500">No noise rules yet.</p>
                ) : (
                  noiseRules.map(rule => (
                    <div
                      key={rule.id}
                      className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-start justify-between gap-2"
                    >
                      <div>
                        <div className="text-sm text-white font-semibold">{rule.normalizedName}</div>
                        {rule.rawNames?.length ? (
                          <p className="text-[10px] text-slate-400 mt-1">
                            {rule.rawNames.slice(0, 2).map(entry => entry.name).join(', ')}
                            {rule.rawNames.length > 2 ? '…' : ''}
                          </p>
                        ) : null}
                      </div>
                      <button
                        onClick={() => void onDeleteNoiseRule(rule.id)}
                        className="px-2 py-1 rounded-full text-[10px] font-semibold border border-red-500/40 text-red-300 bg-red-500/10 hover:bg-red-500/20"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default ManagementReceiptInsights;
