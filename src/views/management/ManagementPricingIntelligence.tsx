import React, { useCallback, useEffect, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import {
  ApprovalRequest,
  AuditLog,
  AuditLogType,
  Product,
  ScannerMode,
  StoreRecord,
  UnmappedUpcData,
  UpcItem
} from '../../types';
import { BACKEND_URL } from '../../constants';
import ManagementApprovals from './ManagementApprovals';
import ManagementAuditLogs from './ManagementAuditLogs';
import ManagementStores from './ManagementStores';
import ManagementUpcRegistry from './ManagementUpcRegistry';
import { UPC_CONTAINER_LABELS } from './constants';

interface ReceiptCapture {
  _id: string;
  storeId: string;
  storeName: string;
  orderId?: string;
  status: string;
  imageCount: number;
  stats: {
    totalItems: number;
    itemsNeedingReview: number;
    itemsConfirmed: number;
    itemsCommitted: number;
  };
  workflowStats?: {
    newProducts?: number;
    priceUpdates?: number;
  };
  createdAt: string;
  reviewExpiresAt?: string;
}

interface ReceiptAliasRecord {
  _id: string;
  normalizedName: string;
  storeId: string;
  storeName: string | null;
  productId: string;
  productName: string | null;
  productSku: string | null;
  upc: string | null;
  confirmedCount: number;
  matchConfidence: number;
  baseConfidence?: number;
  effectiveConfidence?: number;
  lastSeenAt?: string;
  lastConfirmedAt?: string | null;
  rawNames: Array<{ name: string; firstSeen?: string; occurrences?: number }>;
  lockToken: string | null;
}

interface ManagementPricingIntelligenceProps {
  setScannerMode: (mode: ScannerMode) => void;
  setScannerModalOpen: (open: boolean) => void;
  approvalFilter: ApprovalRequest['status'];
  setApprovalFilter: (status: ApprovalRequest['status']) => void;
  filteredApprovals: ApprovalRequest[];
  handleApprove: (approval: ApprovalRequest) => void;
  handleReject: (id: string) => void;
  setSelectedApproval: (approval: ApprovalRequest | null) => void;
  setPreviewPhoto: (photo: string | null) => void;
  fmtTime: (iso?: string) => string;
  stores: StoreRecord[];
  activeStoreId: string;
  setActiveStoreId: (id: string) => void;
  refreshStores: () => Promise<void>;
  isLoadingStores: boolean;
  storeError: string | null;
  setStoreError: (err: string | null) => void;
  upcItems: UpcItem[];
  setUpcItems: (items: UpcItem[]) => void;
  upcInput: string;
  setUpcInput: (value: string) => void;
  upcDraft: UpcItem;
  setUpcDraft: (draft: UpcItem) => void;
  upcFilter: string;
  setUpcFilter: (value: string) => void;
  isUpcLoading: boolean;
  isUpcSaving: boolean;
  upcError: string | null;
  apiLoadUpcItems: () => Promise<void>;
  handleUpcLookup: (upc?: string) => void;
  apiSaveUpc: () => Promise<void>;
  apiDeleteUpc: () => Promise<void>;
  apiDeleteUpcDirect: (upc: string) => Promise<void>;
  apiLinkUpc: (upc: string, productId: string) => Promise<void>;
  filteredUpcItems: UpcItem[];
  loadUpcDraft: (entry: UpcItem) => void;
  products: Product[];
  unmappedUpcModalOpen: boolean;
  setUnmappedUpcModalOpen: (open: boolean) => void;
  unmappedUpcPayload: UnmappedUpcData | null;
  setUnmappedUpcPayload: (payload: UnmappedUpcData | null) => void;
  filteredAuditLogs: AuditLog[];
  auditTypeFilter: 'ALL' | AuditLogType;
  setAuditTypeFilter: (type: 'ALL' | AuditLogType) => void;
  auditActorFilter: string;
  setAuditActorFilter: (actor: string) => void;
  auditRangeFilter: '24h' | '7d' | '30d';
  setAuditRangeFilter: (range: '24h' | '7d' | '30d') => void;
  auditTypeOptions: (string | AuditLogType)[];
  isAuditLogsLoading: boolean;
  auditLogsError: string | null;
  handleDownloadAuditCsv: () => void;
  runAuditSummary: () => void;
  auditSummary: string | null;
  isAuditSummaryLoading: boolean;
}

const ManagementPricingIntelligence: React.FC<ManagementPricingIntelligenceProps> = ({
  setScannerMode,
  setScannerModalOpen,
  approvalFilter,
  setApprovalFilter,
  filteredApprovals,
  handleApprove,
  handleReject,
  setSelectedApproval,
  setPreviewPhoto,
  fmtTime,
  stores,
  activeStoreId,
  setActiveStoreId,
  refreshStores,
  isLoadingStores,
  storeError,
  setStoreError,
  upcItems,
  setUpcItems,
  upcInput,
  setUpcInput,
  upcDraft,
  setUpcDraft,
  upcFilter,
  setUpcFilter,
  isUpcLoading,
  isUpcSaving,
  upcError,
  apiLoadUpcItems,
  handleUpcLookup,
  apiSaveUpc,
  apiDeleteUpc,
  apiDeleteUpcDirect,
  apiLinkUpc,
  filteredUpcItems,
  loadUpcDraft,
  products,
  unmappedUpcModalOpen,
  setUnmappedUpcModalOpen,
  unmappedUpcPayload,
  setUnmappedUpcPayload,
  filteredAuditLogs,
  auditTypeFilter,
  setAuditTypeFilter,
  auditActorFilter,
  setAuditActorFilter,
  auditRangeFilter,
  setAuditRangeFilter,
  auditTypeOptions,
  isAuditLogsLoading,
  auditLogsError,
  handleDownloadAuditCsv,
  runAuditSummary,
  auditSummary,
  isAuditSummaryLoading
}) => {
  const [receiptCaptures, setReceiptCaptures] = useState<ReceiptCapture[]>([]);
  const [receiptAliases, setReceiptAliases] = useState<ReceiptAliasRecord[]>([]);
  const [isAliasLoading, setIsAliasLoading] = useState(false);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [aliasActionId, setAliasActionId] = useState<string | null>(null);

  const openReceiptScanner = () => {
    setScannerMode(ScannerMode.RECEIPT_PARSE_LIVE);
    setScannerModalOpen(true);
  };

  const fetchReceiptCaptures = useCallback(async () => {
    try {
      const resp = await fetch(
        `${BACKEND_URL}/api/driver/receipt-captures?status=pending_parse&status=parsed&status=review_complete&limit=20`,
        {
          credentials: 'include'
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        setReceiptCaptures(data.captures || []);
      }
    } catch (error) {
      console.error('Error fetching receipt captures:', error);
    }
  }, []);

  const fetchReceiptAliases = useCallback(async () => {
    setIsAliasLoading(true);
    setAliasError(null);

    try {
      const params = new URLSearchParams();
      if (activeStoreId) {
        params.set('storeId', activeStoreId);
      }
      params.set('limit', '75');

      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-aliases?${params.toString()}`, {
        credentials: 'include'
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to load aliases');
      }

      const data = await resp.json();
      setReceiptAliases(data.aliases || []);
    } catch (error) {
      console.error('Error fetching receipt aliases:', error);
      setAliasError(error instanceof Error ? error.message : 'Failed to load aliases');
    } finally {
      setIsAliasLoading(false);
    }
  }, [activeStoreId]);

  const updateAliasState = (updatedAlias: ReceiptAliasRecord) => {
    setReceiptAliases(prev =>
      prev.map(alias => (alias._id === updatedAlias._id ? updatedAlias : alias))
    );
  };

  const handleAliasAction = async (aliasId: string, lockToken: string | null, action: 'confirm' | 'reject') => {
    if (!lockToken) {
      setAliasError('Missing alias lock token. Refresh and try again.');
      return;
    }

    setAliasActionId(aliasId);
    setAliasError(null);

    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-alias-${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ aliasId, lockToken })
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        if (data?.alias) {
          updateAliasState(data.alias);
        }
        throw new Error(data?.error || `Failed to ${action} alias`);
      }

      if (data?.alias) {
        updateAliasState(data.alias);
      }
    } catch (error) {
      console.error(`Error attempting to ${action} alias:`, error);
      setAliasError(error instanceof Error ? error.message : `Failed to ${action} alias`);
    } finally {
      setAliasActionId(null);
    }
  };

  const deleteReceiptCapture = async (captureId: string) => {
    if (!window.confirm('Delete this receipt? This cannot be undone.')) {
      return;
    }

    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-capture/${captureId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (resp.ok) {
        setReceiptCaptures(prev => prev.filter(c => c._id !== captureId));
      } else {
        alert('Failed to delete receipt');
      }
    } catch (error) {
      console.error('Error deleting receipt:', error);
      alert('Error deleting receipt');
    }
  };

  useEffect(() => {
    const id = setInterval(() => {
      fetchReceiptCaptures();
    }, 30000);
    return () => clearInterval(id);
  }, [fetchReceiptCaptures]);

  useEffect(() => {
    fetchReceiptCaptures();
  }, [fetchReceiptCaptures]);

  useEffect(() => {
    const handleQueueRefresh = () => {
      fetchReceiptCaptures();
    };

    window.addEventListener('receipt-queue-refresh', handleQueueRefresh);
    return () => window.removeEventListener('receipt-queue-refresh', handleQueueRefresh);
  }, [fetchReceiptCaptures]);

  useEffect(() => {
    fetchReceiptAliases();
  }, [fetchReceiptAliases]);

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-black uppercase text-white tracking-widest">
            Pricing Intelligence
          </h2>
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
            receipts • review queue • price updates • alias bindings • audit history
          </p>
        </div>
      </section>

      <section className="space-y-6">
        <div className="bg-gradient-to-r from-orange-600 to-amber-600 rounded-2xl p-6 border border-white/20">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-black uppercase text-white tracking-widest flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Upload Receipt
              </h3>
              <p className="text-sm text-orange-100 mt-2">Capture and process a new receipt</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={openReceiptScanner}
                className="px-6 py-3 bg-white/20 hover:bg-white/30 text-white rounded-lg font-bold text-sm flex items-center gap-2 transition-all"
                title="Use scanner to capture receipts"
              >
                <Camera className="w-5 h-5" />
                Capture / Upload
              </button>
            </div>
          </div>
        </div>

        {receiptCaptures.length > 0 && (
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl p-6 border border-white/20">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black uppercase text-white tracking-widest flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Receipt Scanner Queue
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-sm text-purple-100">
                  {receiptCaptures.filter(c => c.status === 'parsed').length} pending review
                </span>
                <button
                  onClick={openReceiptScanner}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-white text-sm font-semibold flex items-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  New Receipt
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {receiptCaptures.slice(0, 6).map(capture => (
                <div
                  key={capture._id}
                  className="bg-white/10 backdrop-blur-sm rounded-lg p-4 hover:bg-white/20 transition-all border border-white/10 group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1">
                      <span className="text-white font-bold text-sm">{capture.storeName}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          capture.status === 'parsed'
                            ? 'bg-yellow-500 text-yellow-900'
                            : capture.status === 'review_complete'
                            ? 'bg-green-500 text-green-900'
                            : 'bg-gray-500 text-gray-900'
                        }`}
                      >
                        {capture.status.replace(/_/g, ' ')}
                      </span>

                      <button
                        onClick={event => {
                          event.stopPropagation();
                          deleteReceiptCapture(capture._id);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/30 rounded text-red-400 hover:text-red-300"
                        title="Delete this receipt"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-purple-100 space-y-1">
                      <div>
                        {capture.imageCount} photo{capture.imageCount !== 1 ? 's' : ''}
                      </div>
                      <div>
                        {capture.stats.itemsConfirmed}/{capture.stats.totalItems} items confirmed
                      </div>

                      {capture.workflowStats && (
                        <div className="flex items-center gap-2 mt-2">
                          {capture.workflowStats.newProducts && capture.workflowStats.newProducts > 0 ? (
                            <span className="bg-orange-500/30 text-orange-200 text-xs px-2 py-1 rounded">
                              {capture.workflowStats.newProducts} NEW
                            </span>
                          ) : null}
                          {capture.workflowStats.priceUpdates && capture.workflowStats.priceUpdates > 0 ? (
                            <span className="bg-blue-500/30 text-blue-200 text-xs px-2 py-1 rounded">
                              {capture.workflowStats.priceUpdates} PRICES
                            </span>
                          ) : null}
                        </div>
                      )}

                      {capture.stats.itemsNeedingReview > 0 && (
                        <div className="text-yellow-300 font-semibold">
                          {capture.stats.itemsNeedingReview} need review
                        </div>
                      )}
                    </div>

                    <div className="mt-3 text-xs text-purple-200">
                      {new Date(capture.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="bg-slate-900/60 rounded-2xl p-6 border border-slate-700">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-black uppercase text-white tracking-widest">Aliases / Bindings</h3>
              <p className="text-xs text-slate-400 mt-2">
                Receipt name aliases mapped to products for the active store.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">
                {receiptAliases.length} aliases
              </span>
              <button
                onClick={fetchReceiptAliases}
                className="px-3 py-2 rounded-lg border border-slate-600 text-slate-200 text-xs font-semibold hover:bg-slate-800"
              >
                Refresh
              </button>
            </div>
          </div>

          {aliasError && (
            <div className="mt-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              {aliasError}
            </div>
          )}

          {isAliasLoading ? (
            <div className="mt-6 text-sm text-slate-400">Loading aliases…</div>
          ) : receiptAliases.length === 0 ? (
            <div className="mt-6 text-sm text-slate-400">No alias bindings found yet.</div>
          ) : (
            <div className="mt-6 space-y-4">
              {receiptAliases.map(alias => {
                const baseConfidence = alias.baseConfidence ?? alias.matchConfidence;
                const effectiveConfidence = alias.effectiveConfidence ?? alias.matchConfidence;
                return (
                  <div
                    key={alias._id}
                    className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-bold text-white">
                          {alias.normalizedName}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {alias.productName || 'Unknown product'}
                          {alias.productSku ? ` • ${alias.productSku}` : ''}
                          {alias.upc ? ` • UPC ${alias.upc}` : ''}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          Store: {alias.storeName || 'Unknown'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleAliasAction(alias._id, alias.lockToken, 'confirm')}
                          disabled={aliasActionId === alias._id}
                          className="px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-200 text-xs font-semibold hover:bg-emerald-500/30 disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => handleAliasAction(alias._id, alias.lockToken, 'reject')}
                          disabled={aliasActionId === alias._id}
                          className="px-3 py-2 rounded-lg bg-rose-500/20 text-rose-200 text-xs font-semibold hover:bg-rose-500/30 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3 text-xs text-slate-300">
                      <div>
                        <div className="text-slate-500 uppercase tracking-wide">Confirmed Count</div>
                        <div className="text-white font-semibold text-sm mt-1">
                          {alias.confirmedCount}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 uppercase tracking-wide">Confidence</div>
                        <div className="text-white font-semibold text-sm mt-1">
                          {Math.round(baseConfidence * 100)}% base / {Math.round(effectiveConfidence * 100)}% effective
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 uppercase tracking-wide">Last Seen</div>
                        <div className="text-white font-semibold text-sm mt-1">
                          {fmtTime(alias.lastSeenAt)}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-slate-400">
                      <div className="text-slate-500 uppercase tracking-wide">Raw Name History</div>
                      {alias.rawNames.length === 0 ? (
                        <div className="mt-2">No raw name history captured.</div>
                      ) : (
                        <ul className="mt-2 space-y-1">
                          {alias.rawNames.map((entry, index) => (
                            <li key={`${alias._id}-raw-${index}`} className="flex flex-wrap gap-2">
                              <span className="text-slate-200">{entry.name}</span>
                              <span className="text-slate-500">•</span>
                              <span>{entry.occurrences || 0}x</span>
                              {entry.firstSeen ? (
                                <span className="text-slate-500">since {fmtTime(entry.firstSeen)}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <ManagementApprovals
          approvalFilter={approvalFilter}
          setApprovalFilter={setApprovalFilter}
          filteredApprovals={filteredApprovals}
          handleApprove={handleApprove}
          handleReject={handleReject}
          setSelectedApproval={setSelectedApproval}
          setPreviewPhoto={setPreviewPhoto}
          fmtTime={fmtTime}
        />
      </section>

      <section className="space-y-4">
        <ManagementStores
          stores={stores}
          activeStoreId={activeStoreId}
          setActiveStoreId={setActiveStoreId}
          refreshStores={refreshStores}
          isLoading={isLoadingStores}
          error={storeError}
          setError={setStoreError}
        />
      </section>

      <section className="space-y-4">
        <ManagementUpcRegistry
          upcItems={upcItems}
          setUpcItems={setUpcItems}
          upcInput={upcInput}
          setUpcInput={setUpcInput}
          upcDraft={upcDraft}
          setUpcDraft={setUpcDraft}
          upcFilter={upcFilter}
          setUpcFilter={setUpcFilter}
          isUpcLoading={isUpcLoading}
          isUpcSaving={isUpcSaving}
          upcError={upcError}
          apiLoadUpcItems={apiLoadUpcItems}
          handleUpcLookup={handleUpcLookup}
          apiSaveUpc={apiSaveUpc}
          apiDeleteUpc={apiDeleteUpc}
          apiDeleteUpcDirect={apiDeleteUpcDirect}
          apiLinkUpc={apiLinkUpc}
          filteredUpcItems={filteredUpcItems}
          loadUpcDraft={loadUpcDraft}
          products={products}
          unmappedUpcModalOpen={unmappedUpcModalOpen}
          setUnmappedUpcModalOpen={setUnmappedUpcModalOpen}
          unmappedUpcPayload={unmappedUpcPayload}
          setUnmappedUpcPayload={setUnmappedUpcPayload}
          ScannerModal={null}
          UPC_CONTAINER_LABELS={UPC_CONTAINER_LABELS}
        />
      </section>

      <section className="space-y-4">
        <ManagementAuditLogs
          filteredAuditLogs={filteredAuditLogs}
          auditTypeFilter={auditTypeFilter}
          setAuditTypeFilter={setAuditTypeFilter}
          auditActorFilter={auditActorFilter}
          setAuditActorFilter={setAuditActorFilter}
          auditRangeFilter={auditRangeFilter}
          setAuditRangeFilter={setAuditRangeFilter}
          auditTypeOptions={auditTypeOptions}
          isAuditLogsLoading={isAuditLogsLoading}
          auditLogsError={auditLogsError}
          handleDownloadAuditCsv={handleDownloadAuditCsv}
          runAuditSummary={runAuditSummary}
          auditSummary={auditSummary}
          isAuditSummaryLoading={isAuditSummaryLoading}
          fmtTime={fmtTime}
        />
      </section>
    </div>
  );
};

export default ManagementPricingIntelligence;
