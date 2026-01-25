import React from 'react';
import { Trash2 } from 'lucide-react';
import { UpcItem, Product, UpcContainerType, SizeUnit } from '../../types';

interface ManagementUpcRegistryProps {
  upcItems: UpcItem[];
  setUpcItems: (items: UpcItem[]) => void;
  upcInput: string;
  setUpcInput: (input: string) => void;
  upcDraft: UpcItem;
  setUpcDraft: (draft: UpcItem) => void;
  upcFilter: string;
  setUpcFilter: (filter: string) => void;
  isUpcLoading: boolean;
  isUpcSaving: boolean;
  upcError: string | null;
  apiLoadUpcItems: () => void;
  handleUpcLookup: (upc?: string) => void;
  apiSaveUpc: () => void;
  apiDeleteUpc: () => void;
  apiDeleteUpcDirect: (upc: string) => void;
  apiLinkUpc: (upc: string, productId: string) => void;
  filteredUpcItems: UpcItem[];
  loadUpcDraft: (entry: UpcItem) => void;
  products: Product[];
  unmappedUpcModalOpen: boolean;
  setUnmappedUpcModalOpen: (open: boolean) => void;
  unmappedUpcPayload: any;
  setUnmappedUpcPayload: (payload: any) => void;
  ScannerModal: React.ReactNode;
  containerLabels: Record<UpcContainerType, string>;
}

const fmtTime = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

const formatSize = (value: number, unit?: SizeUnit) => {
  if (!value) return 'No size';
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return 'No size';
  const label = unit || 'oz';
  const decimals = label === 'oz' || label === 'fl oz' ? 1 : 0;
  return `${normalized.toFixed(decimals)} ${label}`;
};

const ManagementUpcRegistry: React.FC<ManagementUpcRegistryProps> = props => {
  const {
    upcItems,
    upcInput,
    setUpcInput,
    upcDraft,
    upcFilter,
    setUpcFilter,
    isUpcLoading,
    isUpcSaving,
    upcError,
    apiLoadUpcItems,
    handleUpcLookup,
    apiDeleteUpcDirect,
    filteredUpcItems,
    loadUpcDraft,
    containerLabels
  } = props;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black uppercase text-white tracking-widest">
          UPC Registry Maintenance
        </h2>
        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
          View UPC codes, product metadata, and Michigan deposit eligibility.
        </p>
      </div>

      <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
          UPC Lookup & View
        </p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Registry updates are managed through inventory create/edit flows.
        </p>

        {upcError && (
          <div className="bg-ninpo-card p-4 rounded-2xl border border-ninpo-red/20 text-[11px] text-ninpo-red">
            {upcError}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2">
              UPC Code
            </label>
            <input
              id="upcLookup"
              name="upcLookup"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
              placeholder="Enter UPC to lookup"
              value={upcInput}
              onChange={e => setUpcInput(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600">
              Actions
            </label>
            <div className="flex gap-2">
              <button
                onClick={handleUpcLookup}
                disabled={!upcInput.trim()}
                className="px-4 py-4 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Lookup
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2">
              Product Name
            </label>
            <input
              id="upcProductName"
              name="upcProductName"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full opacity-70"
              placeholder="No selection"
              value={upcDraft.name || ''}
              readOnly
              disabled
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2">
              Price ($)
            </label>
            <input
              id="upcProductPrice"
              name="upcProductPrice"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full opacity-70"
              placeholder="0.00"
              value={upcDraft.price ? Number(upcDraft.price).toFixed(2) : ''}
              readOnly
              disabled
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2">
              Size
            </label>
            <input
              id="upcProductSize"
              name="upcProductSize"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full opacity-70"
              placeholder="No size"
              value={formatSize(Number(upcDraft.sizeOz || 0), upcDraft.sizeUnit)}
              readOnly
              disabled
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2">
              Container Type
            </label>
            <input
              id="upcContainerType"
              name="upcContainerType"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full opacity-70"
              placeholder="Unknown"
              value={
                upcDraft.containerType && containerLabels
                  ? containerLabels[upcDraft.containerType]
                  : ''
              }
              readOnly
              disabled
            />
          </div>
          <div className="md:col-span-2">
            <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <input
                id="upcIsEligible"
                name="upcIsEligible"
                type="checkbox"
                checked={upcDraft.isEligible}
                readOnly
                disabled
              />
              Eligible for Michigan Deposit Refund
            </label>
          </div>
        </div>
      </div>

      <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
            Registered UPCs
          </p>
          <div className="flex gap-3">
            <input
              id="upcFilter"
              name="upcFilter"
              className="bg-black/40 border border-white/10 rounded-2xl p-3 text-xs text-white"
              placeholder="Filter by UPC or name"
              value={upcFilter}
              onChange={e => setUpcFilter(e.target.value)}
            />
            <button
              onClick={apiLoadUpcItems}
              disabled={isUpcLoading}
              className="px-5 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
            >
              {isUpcLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        {isUpcLoading ? (
          <p className="text-xs text-slate-500">Loading UPC entries...</p>
        ) : filteredUpcItems.length === 0 ? (
          <p className="text-xs text-slate-500">
            {upcItems.length === 0
              ? 'No UPC entries yet. Add UPCs via inventory create/edit.'
              : 'No UPC entries match this filter.'}
          </p>
        ) : (
          <div className="space-y-3">
            {filteredUpcItems.map(item => {
              const containerLabel = item.containerType && containerLabels
                ? containerLabels[item.containerType]
                : containerLabels?.plastic || 'Plastic';
              
              return (
                <div
                  key={item.upc}
                  className="flex items-center gap-3 p-4 rounded-2xl border border-white/5 bg-black/40"
                >
                <button
                  onClick={() => {
                    setUpcInput(item.upc);
                    loadUpcDraft(item);
                  }}
                  className="flex-1 text-left hover:bg-white/5 transition-all rounded-xl p-2 -m-2"
                >
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <p className="text-white text-sm font-black">{item.upc}</p>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500">
                        {item.name || 'Unnamed'} • Deposit $
                        {Number(item.depositValue || 0).toFixed(2)} • Price $
                        {Number(item.price || 0).toFixed(2)} •{' '}
                        {formatSize(item.sizeOz, item.sizeUnit)} •{' '}
                        {containerLabel} •{' '}
                        {item.isEligible ? 'ELIGIBLE' : 'INELIGIBLE'}
                      </p>
                    </div>
                    <p className="text-[10px] uppercase tracking-widest text-slate-600">
                      Updated {fmtTime(item.updatedAt)}
                    </p>
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete UPC ${item.upc}?`)) {
                      apiDeleteUpcDirect(item.upc);
                    }
                  }}
                  disabled={isUpcSaving}
                  className="p-3 rounded-xl bg-ninpo-red/10 text-ninpo-red hover:bg-ninpo-red/20 border border-ninpo-red/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Delete UPC"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ManagementUpcRegistry;
