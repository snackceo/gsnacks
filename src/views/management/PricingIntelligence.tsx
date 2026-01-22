import React, { useState } from 'react';
import { Receipt, FileText, TrendingUp, Settings, CheckCircle2 } from 'lucide-react';

interface PricingIntelligenceProps {
  // Will expand as we add features
}

type PricingTab = 'upload' | 'pending' | 'aliases' | 'timeline' | 'health';

const PricingIntelligence: React.FC<PricingIntelligenceProps> = () => {
  const [activeTab, setActiveTab] = useState<PricingTab>('upload');

  const tabs = [
    { id: 'upload' as PricingTab, label: 'Receipt Upload', icon: Receipt },
    { id: 'pending' as PricingTab, label: 'Pending Receipts', icon: FileText },
    { id: 'aliases' as PricingTab, label: 'Alias Management', icon: Settings },
    { id: 'timeline' as PricingTab, label: 'Price Timeline', icon: TrendingUp },
    { id: 'health' as PricingTab, label: 'System Health', icon: CheckCircle2 }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-white text-2xl font-black uppercase tracking-widest">
          Pricing Intelligence
        </h2>
        <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-2">
          Advanced receipt processing & price tracking
        </p>
      </div>

      {/* Sub-navigation tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`shrink-0 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-3 ${
              activeTab === tab.id
                ? 'bg-ninpo-lime text-ninpo-black shadow-neon'
                : 'bg-white/5 hover:bg-white/10 text-slate-400'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-white/5 rounded-[2rem] border border-white/10 p-8">
        {activeTab === 'upload' && (
          <div className="text-center py-12">
            <Receipt className="w-16 h-16 mx-auto mb-4 text-slate-500" />
            <h3 className="text-white text-lg font-bold mb-2">Receipt Upload</h3>
            <p className="text-slate-400 text-sm">Upload and scan receipts to update inventory prices</p>
          </div>
        )}
        
        {activeTab === 'pending' && (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 mx-auto mb-4 text-slate-500" />
            <h3 className="text-white text-lg font-bold mb-2">Pending Receipts</h3>
            <p className="text-slate-400 text-sm">Review queue for receipts requiring attention</p>
          </div>
        )}

        {activeTab === 'aliases' && (
          <div className="text-center py-12">
            <Settings className="w-16 h-16 mx-auto mb-4 text-slate-500" />
            <h3 className="text-white text-lg font-bold mb-2">Alias Management</h3>
            <p className="text-slate-400 text-sm">Manage receipt name aliases and confidence scores</p>
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="text-center py-12">
            <TrendingUp className="w-16 h-16 mx-auto mb-4 text-slate-500" />
            <h3 className="text-white text-lg font-bold mb-2">Price Timeline</h3>
            <p className="text-slate-400 text-sm">Historical price trends per product and store</p>
          </div>
        )}

        {activeTab === 'health' && (
          <div className="text-center py-12">
            <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-slate-500" />
            <h3 className="text-white text-lg font-bold mb-2">System Health</h3>
            <p className="text-slate-400 text-sm">Auto-match rates and system metrics</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PricingIntelligence;