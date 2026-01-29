
import React from 'react';
import ReceiptItemBucket from '../../../components/ReceiptItemBucket';
import ScannerModal from '../../../components/ScannerModal';
import { ReceiptStoreCandidate, ScannerMode, StoreRecord } from '../../../types';
import { getReceiptItemKey } from '../../../utils/receiptHelpers';

interface ReceiptApprovalIssue {
  label: string;
  messages: string[];
  severity: 'blocking' | 'advisory';
}

interface ReceiptReviewPanelProps {
  activeReceiptCaptureId: string;
  classifiedItems: any[];
  approvalMode: 'safe' | 'selected' | 'locked' | 'all';
  isCommitting: boolean;
  hasBlockingIssues: boolean;
  lockDurationDays: number;
  selectedItemsForCommit: Map<string, boolean>;
  approvalIssues: ReceiptApprovalIssue[];
  storeBlockingIssues: string[];
  storeAdvisoryIssues: string[];
  approvalNotes: string;
  onApprovalNotesChange: (value: string) => void;
  show: boolean;
  onClose: () => void;
  onParse: () => void;
  onConfirmAll: () => void;
  onResetReview: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onApprovalMode: (mode: 'safe' | 'selected' | 'locked' | 'all') => void;
  onSelectAll: () => void;
  onSelectSafe: () => void;
  onClearSelection: () => void;
  onCommit: () => void;
  onScanItem: (item: any) => void;
  onSearchProduct: (item: any) => void;
  onCreateProduct: (item: any) => void;
  onSelectForCommit: (item: any, checked?: boolean) => void;
  onAddNoiseRule: (normalizedName: string) => void;
  scanModalOpen: boolean;
  handleScannerScan: (upc: string) => void;
  handleScannerClose: () => void;
  settings: any;
  confirmStoreCreate: boolean;
  forceUpcOverride: boolean;
  finalStoreId: string;
  onConfirmStoreCreate: (value: boolean) => void;
  onForceUpcOverride: (value: boolean) => void;
  onFinalStoreIdChange: (value: string) => void;
  onLockDurationChange: (value: number) => void;
  stores: StoreRecord[];
  storeCandidate?: ReceiptStoreCandidate;
}

const ReceiptReviewPanel: React.FC<ReceiptReviewPanelProps> = ({
  activeReceiptCaptureId,
  classifiedItems,
  approvalMode,
  isCommitting,
  hasBlockingIssues,
  lockDurationDays,
  selectedItemsForCommit,
  approvalIssues,
  storeBlockingIssues,
  storeAdvisoryIssues,
  approvalNotes,
  onApprovalNotesChange,
  show,
  onClose,
  onParse,
  onConfirmAll,
  onResetReview,
  onLock,
  onUnlock,
  onApprovalMode,
  onSelectAll,
  onSelectSafe,
  onClearSelection,
  onCommit,
  onScanItem,
  onSearchProduct,
  onCreateProduct,
  onSelectForCommit,
  onAddNoiseRule,
  scanModalOpen,
  handleScannerScan,
  handleScannerClose,
  settings,
  confirmStoreCreate,
  forceUpcOverride,
  finalStoreId,
  onConfirmStoreCreate,
  onForceUpcOverride,
  onFinalStoreIdChange,
  onLockDurationChange,
  stores,
  storeCandidate
}) => {
  if (!show) return null;
  const selectedForCommitCount = selectedItemsForCommit.size;
  const activeStoreLabel = stores.find(store => store.id === finalStoreId)?.name;
  const storeCandidateLabel = storeCandidate?.name || 'Unknown store';
  const shouldConfirmStoreCreate = !storeCandidate?.storeId && !finalStoreId;
  const blockingIssues = approvalIssues.filter(issue => issue.severity === 'blocking');
  const advisoryIssues = approvalIssues.filter(issue => issue.severity === 'advisory');
  return (
    <div className="fixed inset-0 z-50 bg-ninpo-black/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-ninpo-card rounded-[2rem] border border-white/10 max-w-6xl w-full h-[85vh] overflow-y-auto">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div>
            <h3 className="text-white font-black uppercase text-lg tracking-widest">Receipt Review</h3>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">Capture ID: {activeReceiptCaptureId}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex flex-wrap gap-3 items-center">
            <button
              onClick={onParse}
              className="px-4 py-2 rounded-full text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20"
            >
              Parse Receipt
            </button>
            <button
              onClick={onConfirmAll}
              className="px-4 py-2 rounded-full text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20"
            >
              Select All
            </button>
            <button
              onClick={onSelectSafe}
              className="px-4 py-2 rounded-full text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20"
            >
              Select Auto-Update
            </button>
            <button
              onClick={onResetReview}
              className="px-4 py-2 rounded-full text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20"
            >
              Reset Review
            </button>
            <button
              onClick={onLock}
              className="px-4 py-2 rounded-full text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20"
            >
              Lock {lockDurationDays}d
            </button>
            <button
              onClick={onUnlock}
              className="px-4 py-2 rounded-full text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20"
            >
              Unlock
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
            <div className="space-y-4">
              {classifiedItems.length === 0 ? (
                <div className="text-xs text-slate-400">No items to review.</div>
              ) : (
                <ReceiptItemBucket
                  items={Array.isArray(classifiedItems) ? classifiedItems : []}
                  selectedItems={selectedItemsForCommit}
                  getItemKey={getReceiptItemKey}
                  onItemToggle={(item, _classification, checked) => onSelectForCommit(item, checked)}
                  onItemScanUpc={onScanItem}
                  onItemSearchProduct={onSearchProduct}
                  onItemCreateProduct={onCreateProduct}
                  onItemNeverMatch={item => onAddNoiseRule(item.normalizedName || '')}
                />
              )}
            </div>

            <div className="space-y-4">
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">Commit Summary</p>
                <p className="text-sm text-white font-semibold mt-2">{selectedForCommitCount} selected</p>
                <div className="mt-2 text-[10px] text-slate-400">
                  Store: {activeStoreLabel || storeCandidateLabel}
                </div>
                {(storeBlockingIssues.length > 0 || storeAdvisoryIssues.length > 0) && (
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3 text-[10px] text-slate-200 space-y-2">
                    {storeBlockingIssues.length > 0 && (
                      <div>
                        <p className="font-semibold text-ninpo-red uppercase tracking-widest text-[9px]">Store blocking</p>
                        <ul className="mt-1 space-y-1">
                          {storeBlockingIssues.map(issue => (
                            <li key={issue} className="text-ninpo-red/90">{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {storeAdvisoryIssues.length > 0 && (
                      <div>
                        <p className="font-semibold text-yellow-200 uppercase tracking-widest text-[9px]">Store advisory</p>
                        <ul className="mt-1 space-y-1">
                          {storeAdvisoryIssues.map(issue => (
                            <li key={issue} className="text-yellow-100/80">{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => onApprovalMode('safe')}
                    className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                      approvalMode === 'safe'
                        ? 'border-white/50 text-white bg-white/20'
                        : 'border-white/10 text-slate-300'
                    }`}
                  >
                    Safe
                  </button>
                  <button
                    onClick={() => onApprovalMode('selected')}
                    className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                      approvalMode === 'selected'
                        ? 'border-white/50 text-white bg-white/20'
                        : 'border-white/10 text-slate-300'
                    }`}
                  >
                    Selected
                  </button>
                  <button
                    onClick={() => onApprovalMode('locked')}
                    className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                      approvalMode === 'locked'
                        ? 'border-white/50 text-white bg-white/20'
                        : 'border-white/10 text-slate-300'
                    }`}
                  >
                    Locked
                  </button>
                  <button
                    onClick={() => onApprovalMode('all')}
                    className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                      approvalMode === 'all'
                        ? 'border-white/50 text-white bg-white/20'
                        : 'border-white/10 text-slate-300'
                    }`}
                  >
                    All
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={onSelectAll}
                    className="px-3 py-2 rounded-full text-[10px] font-semibold border border-white/10 text-slate-300 hover:bg-white/10"
                  >
                    Select All
                  </button>
                  <button
                    onClick={onClearSelection}
                    className="px-3 py-2 rounded-full text-[10px] font-semibold border border-white/10 text-slate-300 hover:bg-white/10"
                  >
                    Clear Selection
                  </button>
                </div>

                {approvalMode === 'locked' && (
                  <label className="mt-3 block text-[10px] text-slate-400 uppercase tracking-widest">
                    Lock duration (days)
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={lockDurationDays}
                      onChange={event => onLockDurationChange(Number(event.target.value))}
                      className="mt-2 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </label>
                )}

                <div className="mt-3 space-y-2">
                  <label className="flex items-center gap-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={forceUpcOverride}
                      onChange={event => onForceUpcOverride(event.target.checked)}
                    />
                    Force UPC override when conflicts are found
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={confirmStoreCreate}
                      onChange={event => onConfirmStoreCreate(event.target.checked)}
                      disabled={!shouldConfirmStoreCreate}
                    />
                    Confirm store creation if no match is found
                  </label>
                  {shouldConfirmStoreCreate && (
                    <p className="text-[10px] text-slate-500">
                      Store candidate: {storeCandidateLabel}. Approvals require explicit confirmation if a new store must be created.
                    </p>
                  )}
                </div>

                <label className="mt-3 block text-[10px] text-slate-400 uppercase tracking-widest">
                  Final store (override)
                  <select
                    value={finalStoreId}
                    onChange={event => onFinalStoreIdChange(event.target.value)}
                    className="mt-2 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white"
                  >
                    <option value="">Use candidate</option>
                    {stores.map(store => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </label>

                {(blockingIssues.length > 0 || advisoryIssues.length > 0) && (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/40 p-3 text-[10px] text-slate-200 space-y-3">
                    <p className="text-[9px] uppercase tracking-widest text-slate-400">Approval issues</p>
                    {blockingIssues.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[9px] uppercase tracking-widest text-ninpo-red">Blocking</p>
                        {blockingIssues.map(issue => (
                          <div key={`blocking-${issue.label}`} className="rounded-lg border border-ninpo-red/30 bg-ninpo-red/10 p-2">
                            <p className="text-[10px] font-semibold text-ninpo-red/90">{issue.label}</p>
                            <ul className="mt-1 space-y-1">
                              {issue.messages.map(message => (
                                <li key={message} className="text-ninpo-red/80">{message}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                    {advisoryIssues.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[9px] uppercase tracking-widest text-yellow-200">Advisory</p>
                        {advisoryIssues.map(issue => (
                          <div key={`advisory-${issue.label}`} className="rounded-lg border border-yellow-200/30 bg-yellow-200/10 p-2">
                            <p className="text-[10px] font-semibold text-yellow-100">{issue.label}</p>
                            <ul className="mt-1 space-y-1">
                              {issue.messages.map(message => (
                                <li key={message} className="text-yellow-100/80">{message}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <label className="mt-4 block text-[10px] text-slate-400 uppercase tracking-widest">
                  Approval notes
                  <textarea
                    value={approvalNotes}
                    onChange={event => onApprovalNotesChange(event.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white"
                    placeholder="Add any notes for this approval..."
                  />
                </label>

                <button
                  onClick={onCommit}
                  disabled={!approvalMode || isCommitting || hasBlockingIssues}
                  className="mt-4 w-full px-4 py-3 rounded-2xl text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCommitting ? 'Committing…' : 'Approve Receipt'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {scanModalOpen && (
          <ScannerModal
            mode={ScannerMode.RECEIPT_PARSE_LIVE}
            onScan={handleScannerScan}
            onClose={handleScannerClose}
            title="Scan UPC"
            subtitle="Scan the product UPC to attach"
            beepEnabled={settings?.beepEnabled ?? true}
            cooldownMs={settings?.cooldownMs ?? 2000}
            isOpen={scanModalOpen}
          />
        )}
      </div>
    </div>
  );
};

export default ReceiptReviewPanel;
