import React, { useEffect, useMemo } from 'react';
import ReceiptItemBucket from '../../../components/ReceiptItemBucket';
import ScannerModal from '../../../components/ScannerModal';
// See GLOSSARY.md for authoritative definitions of all scanner modes.
import {
  FinalStoreMode,
  ReceiptApprovalAction,
  ReceiptApprovalDraftItem,
  ReceiptStoreCandidate,
  ScannerMode,
  StoreRecord
} from '../../../types';
import { getReceiptItemKey } from '../../../utils/receiptHelpers';

interface ReceiptApprovalIssue {
  label: string;
  messages: string[];
  severity: 'blocking' | 'advisory';
}

interface ReceiptReviewPanelProps {
  canManageProducts: boolean;
  activeReceiptCaptureId: string;
  classifiedItems: any[];
  approvalMode: 'safe' | 'selected' | 'locked' | 'all';
  isCommitting: boolean;
  lockDurationDays: number;
  selectedItemsForCommit: Map<string, boolean>;
  approvalIssues: ReceiptApprovalIssue[];
  storeBlockingIssues: string[];
  storeAdvisoryIssues: string[];
  receiptApprovalStatus: {
    hasBlocking: boolean;
    hasAdvisory: boolean;
    items: Record<string, { blocking: string[]; advisory: string[] }>;
    store: { blocking: string[]; advisory: string[] };
  };
  receiptApprovalItems: Array<ReceiptApprovalDraftItem & { id: string }>;
  approvalNotes: string;
  onApprovalNotesChange: (value: string) => void;
  receiptApprovalIdempotencyKey: string;
  onReceiptApprovalIdempotencyKeyChange: (value: string) => void;
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
  onSelectForCommit: (item: any, checked?: boolean) => void;
  onItemUpcChange: (itemId: string, upc: string) => void;
  onItemActionChange: (itemId: string, action: ReceiptApprovalAction) => void;
  onAddNoiseRule: (normalizedName: string) => void;
  scanModalOpen: boolean;
  handleScannerScan: (upc: string) => void;
  handleScannerClose: () => void;
  settings: any;
  confirmStoreCreate: boolean;
  forceUpcOverride: boolean;
  ignorePriceLocks: boolean;
  canOverridePriceLocks: boolean;
  finalStoreId: string;
  onConfirmStoreCreate: (value: boolean) => void;
  onForceUpcOverride: (value: boolean) => void;
  onIgnorePriceLocks: (value: boolean) => void;
  onFinalStoreIdChange: (value: string) => void;
  finalStoreMode: FinalStoreMode;
  onFinalStoreModeChange: (mode: FinalStoreMode) => void;
  onLockDurationChange: (value: number) => void;
  stores: StoreRecord[];
  storeCandidate?: ReceiptStoreCandidate;
}

const ReceiptReviewPanel: React.FC<ReceiptReviewPanelProps> = ({
  activeReceiptCaptureId,
  classifiedItems,
  approvalMode,
  isCommitting,
  lockDurationDays,
  selectedItemsForCommit,
  approvalIssues,
  storeBlockingIssues,
  storeAdvisoryIssues,
  receiptApprovalStatus,
  receiptApprovalItems,
  approvalNotes,
  onApprovalNotesChange,
  receiptApprovalIdempotencyKey,
  onReceiptApprovalIdempotencyKeyChange,
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
  onSelectForCommit,
  onItemUpcChange,
  onItemActionChange,
  onAddNoiseRule,
  scanModalOpen,
  handleScannerScan,
  handleScannerClose,
  settings,
  confirmStoreCreate,
  forceUpcOverride,
  ignorePriceLocks,
  canOverridePriceLocks,
  finalStoreId,
  onConfirmStoreCreate,
  onForceUpcOverride,
  onIgnorePriceLocks,
  onFinalStoreIdChange,
  finalStoreMode,
  onFinalStoreModeChange,
  onLockDurationChange,
  stores,
  storeCandidate,
  canManageProducts
}) => {
  // ✅ Hooks MUST run even when `show` is false, otherwise React throws error #310.
  const selectedForCommitCount = selectedItemsForCommit.size;
  const activeStoreLabel = stores.find(store => store.id === finalStoreId)?.name;
  const storeCandidateLabel = storeCandidate?.name || 'Unknown store';
  const shouldConfirmStoreCreate = !storeCandidate?.storeId && !finalStoreId;
  const isStoreCandidateMissing = !storeCandidate;

  const storeSummaryBadge =
    finalStoreMode === 'MATCHED'
      ? storeCandidate?.storeId
        ? { label: 'Using matched store', className: 'bg-ninpo-lime/10 text-ninpo-lime border-ninpo-lime/40' }
        : { label: 'Matched store missing', className: 'bg-yellow-200/10 text-yellow-100 border-yellow-200/40' }
      : finalStoreMode === 'EXISTING'
        ? { label: 'Using selected store', className: 'bg-white/10 text-white border-white/20' }
        : { label: 'Using candidate draft', className: 'bg-white/5 text-slate-300 border-white/10' };

  const storeMatchReasonLabel = storeCandidate?.matchReason
    ? ({
        capture_store: 'Capture store',
        phone_match: 'Phone match',
        name_match: 'Name match',
        parsed_store_data: 'Parsed store data'
      } as Record<string, string>)[storeCandidate.matchReason] || storeCandidate.matchReason
    : null;

  const storeConfidenceLabel = typeof storeCandidate?.confidence === 'number' ? storeCandidate.confidence.toFixed(2) : null;

  const blockingIssues = approvalIssues.filter(issue => issue.severity === 'blocking');
  const advisoryIssues = approvalIssues.filter(issue => issue.severity === 'advisory');

  const itemsByLineIndex = useMemo(() => {
    const mapping = new Map<number, any>();
    (Array.isArray(classifiedItems) ? classifiedItems : []).forEach(item => {
      if (typeof item?.lineIndex === 'number') {
        mapping.set(item.lineIndex, item);
      }
    });
    return mapping;
  }, [classifiedItems]);

  const receiptItemRows = useMemo(() => {
    return (Array.isArray(receiptApprovalItems) ? receiptApprovalItems : []).map(item => ({
      ...item,
      source: itemsByLineIndex.get(item.lineIndex)
    }));
  }, [receiptApprovalItems, itemsByLineIndex]);

  const selectedClassifiedItems = useMemo(
    () =>
      (Array.isArray(classifiedItems) ? classifiedItems : []).filter(item =>
        selectedItemsForCommit.has(getReceiptItemKey(item))
      ),
    [classifiedItems, selectedItemsForCommit]
  );

  const selectedLineCount = selectedClassifiedItems.length;
  const selectedLine = selectedLineCount === 1 ? selectedClassifiedItems[0] : null;

  const storeStatusBadge = receiptApprovalStatus.store.blocking.length
    ? { label: 'Blocking', className: 'bg-ninpo-red/20 text-ninpo-red border-ninpo-red/40' }
    : receiptApprovalStatus.store.advisory.length
      ? { label: 'Advisory', className: 'bg-yellow-200/10 text-yellow-100 border-yellow-200/40' }
      : { label: 'Ready', className: 'bg-ninpo-lime/10 text-ninpo-lime border-ninpo-lime/40' };

  const actionOptions: Array<{ value: ReceiptApprovalAction; label: string; disabled?: boolean }> = [
    { value: 'LINK_UPC_TO_PRODUCT', label: 'Link Existing Product' },
    { value: 'CREATE_PRODUCT', label: 'Create Product (disabled)', disabled: true },
    { value: 'IGNORE', label: 'Ignore' }
  ];

  useEffect(() => {
    // Only listen for Escape while the panel is actually shown
    if (!show) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, show]);

  // ✅ Render gate AFTER hooks
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 bg-ninpo-black/90 backdrop-blur-sm flex items-center justify-center p-0 lg:p-4">
      <div
        className="fixed inset-0 bg-ninpo-card border border-white/10 w-full h-[100dvh] overflow-y-auto lg:relative lg:inset-auto lg:max-w-6xl lg:h-[85vh] rounded-none lg:rounded-[2rem]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-white transition"
          aria-label="Close receipt review"
        >
          ✕
        </button>

        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div>
            <h3 className="text-white font-black uppercase text-lg tracking-widest">Receipt Review</h3>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">Capture ID: {activeReceiptCaptureId}</p>
            <p className="mt-2 text-[11px] text-slate-300">
              This <span className="font-semibold text-white">ReceiptParseJob</span> stages parsed data for review.
              <span className="font-semibold text-white"> Approve &amp; Apply</span> commits
              <span className="font-semibold text-white"> StoreInventory</span> updates.
            </p>
          </div>
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
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest">Store candidate</p>
                    <p className="text-sm text-white font-semibold mt-2">{storeCandidateLabel}</p>

                    {storeCandidate?.address && (
                      <p className="text-[10px] text-slate-400 mt-1">
                        {storeCandidate.address.street}, {storeCandidate.address.city}
                      </p>
                    )}

                    {storeCandidate?.phone && <p className="text-[10px] text-slate-400 mt-1">{storeCandidate.phone}</p>}

                    {(storeMatchReasonLabel || storeConfidenceLabel) && (
                      <p className="text-[10px] text-slate-400 mt-1">
                        Match: {storeMatchReasonLabel || 'Unknown'}
                        {storeConfidenceLabel ? ` · Confidence ${storeConfidenceLabel}` : ''}
                      </p>
                    )}

                    {isStoreCandidateMissing && (
                      <p className="text-[10px] text-yellow-100/80 mt-2">
                        Store candidate is missing (expected when the receipt header lacks store details or the capture has no
                        pre-selected store).
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={`text-[9px] uppercase tracking-widest rounded-full border px-3 py-1 ${storeStatusBadge.className}`}
                    >
                      {storeStatusBadge.label}
                    </span>

                    {isStoreCandidateMissing && (
                      <span className="text-[9px] uppercase tracking-widest rounded-full border px-3 py-1 bg-yellow-200/10 text-yellow-100 border-yellow-200/40">
                        Store candidate missing
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-3 text-xs text-slate-200">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="finalStoreMode"
                      checked={finalStoreMode === 'MATCHED'}
                      onChange={() => onFinalStoreModeChange('MATCHED')}
                    />
                    Use matched store (if available)
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="finalStoreMode"
                      checked={finalStoreMode === 'EXISTING'}
                      onChange={() => onFinalStoreModeChange('EXISTING')}
                    />
                    Select existing store
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="finalStoreMode"
                      checked={finalStoreMode === 'CREATE_DRAFT'}
                      onChange={() => onFinalStoreModeChange('CREATE_DRAFT')}
                    />
                    Create a store draft
                  </label>
                </div>

                {finalStoreMode === 'EXISTING' && (
                  <label className="mt-3 block text-[10px] text-slate-400 uppercase tracking-widest">
                    Existing store
                    <select
                      value={finalStoreId}
                      onChange={event => onFinalStoreIdChange(event.target.value)}
                      className="mt-2 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white"
                    >
                      <option value="">Select store</option>
                      {stores.map(store => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {finalStoreMode === 'CREATE_DRAFT' && (
                  <div className="mt-3 space-y-2">
                    <label className="flex items-center gap-2 text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={confirmStoreCreate}
                        onChange={event => onConfirmStoreCreate(event.target.checked)}
                        disabled={!shouldConfirmStoreCreate}
                      />
                      Confirm store draft creation
                    </label>

                    {shouldConfirmStoreCreate && (
                      <p className="text-[10px] text-slate-500">
                        Store candidate: {storeCandidateLabel}. Approvals require explicit confirmation if a new store draft must be created.
                      </p>
                    )}
                  </div>
                )}

                {(receiptApprovalStatus.store.blocking.length > 0 || receiptApprovalStatus.store.advisory.length > 0) && (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3 text-[10px] text-slate-200 space-y-2">
                    {receiptApprovalStatus.store.blocking.length > 0 && (
                      <div>
                        <p className="font-semibold text-ninpo-red uppercase tracking-widest text-[9px]">Store blocking</p>
                        <ul className="mt-1 space-y-1">
                          {receiptApprovalStatus.store.blocking.map(issue => (
                            <li key={issue} className="text-ninpo-red/90">
                              {issue}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {receiptApprovalStatus.store.advisory.length > 0 && (
                      <div>
                        <p className="font-semibold text-yellow-200 uppercase tracking-widest text-[9px]">Store advisory</p>
                        <ul className="mt-1 space-y-1">
                          {receiptApprovalStatus.store.advisory.map(issue => (
                            <li key={issue} className="text-yellow-100/80">
                              {issue}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {Array.isArray(classifiedItems) && classifiedItems.length === 0 ? (
                <div className="text-xs text-slate-400">No items to review.</div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-[10px] text-slate-300 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="uppercase tracking-widest text-slate-400">UPC scan helper</p>
                        <p className="mt-1 text-slate-200">
                          UPC scanning is available per line via <span className="font-semibold text-white">Scan UPC</span>.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => selectedLine && onScanItem(selectedLine)}
                        disabled={!selectedLine}
                        className="px-3 py-1.5 rounded-full text-[10px] font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          selectedLine
                            ? 'Scan UPC for the selected line'
                            : 'Select exactly one line to scan a UPC from this shortcut'
                        }
                      >
                        Scan UPC for selected line
                      </button>
                    </div>

                    {!selectedLine && (
                      <p className="text-yellow-100/80">
                        {selectedLineCount === 0
                          ? 'No line selected. Select one receipt line to enable the scanner shortcut.'
                          : 'Multiple lines selected. Keep exactly one selected to use the scanner shortcut.'}
                      </p>
                    )}
                  </div>

                  <ReceiptItemBucket
                    items={Array.isArray(classifiedItems) ? classifiedItems : []}
                    selectedItems={selectedItemsForCommit}
                    getItemKey={getReceiptItemKey}
                    onItemToggle={(item, _classification, checked) => onSelectForCommit(item, checked)}
                    onItemScanUpc={onScanItem}
                    onItemSearchProduct={onSearchProduct}
                    onItemNeverMatch={item => onAddNoiseRule(item.normalizedName || '')}
                  />
                </div>
              )}

              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">Item actions</p>
                <div className="mt-3 space-y-3">
                  {receiptItemRows.map(item => {
                    const status = receiptApprovalStatus.items[item.id];
                    const blockingCount = status?.blocking.length ?? 0;
                    const advisoryCount = status?.advisory.length ?? 0;
                    const itemMatchMethod = item.source?.matchMethod || item.source?.matchHistory?.[0]?.matchMethod;
                    const itemWorkflowType = item.source?.workflowType || item.source?.matchHistory?.[0]?.workflowType;
                    const isUnmappedWorkflow =
                      itemWorkflowType === 'unmapped' ||
                      itemMatchMethod === 'upc_unmapped' ||
                      (!item.productId && item.action !== 'LINK_UPC_TO_PRODUCT');
                    const lineStatusText = isUnmappedWorkflow
                      ? 'Captured as UnmappedProduct for future UPC mapping.'
                      : item.action === 'LINK_UPC_TO_PRODUCT'
                        ? 'Will update StoreInventory and write PriceObservation for the linked product.'
                        : item.action === 'CREATE_UPC'
                          ? 'Will create or refresh the UPC link, then update StoreInventory and PriceObservation.'
                          : 'No apply changes for this line (ignored during Approve & Apply).';

                    return (
                      <div key={item.id} className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs text-white font-semibold">{item.source?.receiptName || `Line ${item.lineIndex}`}</p>
                            <p className="text-[10px] text-slate-400">
                              {item.source?.quantity ? `${item.source.quantity} × ` : ''}
                              {typeof item.source?.unitPrice === 'number' ? `$${item.source.unitPrice.toFixed(2)}` : 'No unit price'}
                            </p>
                            {(itemMatchMethod || itemWorkflowType) && (
                              <p className="text-[10px] text-slate-500 mt-1">
                                {itemMatchMethod ? `Match: ${itemMatchMethod}` : 'Match: unknown'}
                                {itemWorkflowType ? ` • Workflow: ${itemWorkflowType}` : ''}
                              </p>
                            )}
                            <p className="text-[10px] text-slate-300 mt-1">Status: {lineStatusText}</p>
                          </div>

                          <div className="flex items-center gap-2">
                            {blockingCount > 0 && (
                              <span className="text-[9px] uppercase tracking-widest rounded-full border border-ninpo-red/40 bg-ninpo-red/20 text-ninpo-red px-2 py-1">
                                {blockingCount} blocking
                              </span>
                            )}
                            {advisoryCount > 0 && (
                              <span className="text-[9px] uppercase tracking-widest rounded-full border border-yellow-200/40 bg-yellow-200/10 text-yellow-100 px-2 py-1">
                                {advisoryCount} advisory
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3">
                          <label className="text-[10px] text-slate-400 uppercase tracking-widest">
                            UPC
                            <input
                              value={item.upc || ''}
                              onChange={event => onItemUpcChange(item.id, event.target.value)}
                              className="mt-2 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white"
                              placeholder="Scan or enter UPC"
                            />
                            {item.source?.scannedUpc || item.source?.suggestedProduct?.upc ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onItemUpcChange(item.id, item.source?.scannedUpc || item.source?.suggestedProduct?.upc || '')
                                }
                                className="mt-2 px-3 py-1 rounded-full text-[9px] font-semibold border border-white/10 text-slate-300 hover:bg-white/10"
                              >
                                Use suggested UPC
                              </button>
                            ) : null}
                          </label>

                          <label className="text-[10px] text-slate-400 uppercase tracking-widest">
                            Action
                            <select
                              value={item.action}
                              onChange={event => onItemActionChange(item.id, event.target.value as ReceiptApprovalAction)}
                              className="mt-2 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white disabled:bg-black/20 disabled:text-slate-500"
                              disabled={!canManageProducts}
                              title={!canManageProducts ? 'Only managers can change item actions' : undefined}
                            >
                              {actionOptions.map(option => (
                                <option key={option.value} value={option.value} disabled={option.disabled}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            {!canManageProducts && <span className="text-xs text-slate-400 ml-2">Only managers can change item actions</span>}
                          </label>
                        </div>

                        {item.action === 'LINK_UPC_TO_PRODUCT' && (
                          <div className="text-[10px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
                            <span>Linked SKU: {item.sku || 'Not selected'}</span>
                            {item.source && (
                              <button
                                onClick={() => onSearchProduct(item.source)}
                                className="px-3 py-1 rounded-full text-[9px] font-semibold border border-white/10 text-slate-300 hover:bg-white/10"
                              >
                                Search product
                              </button>
                            )}
                          </div>
                        )}

                        {item.action === 'CREATE_PRODUCT' && (
                          <div className="rounded-lg border border-ninpo-red/40 bg-ninpo-red/10 p-3 text-[10px] text-ninpo-red space-y-2">
                            <p className="font-semibold uppercase tracking-widest text-[9px]">Create product disabled</p>
                            <p>Receipt approvals cannot create products. Choose another action before committing.</p>
                            <a
                              href="#/management/inventory"
                              className="text-[10px] font-semibold text-ninpo-lime hover:underline"
                            >
                              Go to Inventory to create products →
                            </a>
                            <button
                              type="button"
                              onClick={() => onItemActionChange(item.id, 'IGNORE')}
                              className="px-3 py-1 rounded-full text-[9px] font-semibold border border-white/10 text-slate-200 bg-white/5 hover:bg-white/10"
                            >
                              Switch to Ignore
                            </button>
                          </div>
                        )}

                        {(status?.blocking.length || status?.advisory.length) && (
                          <div className="rounded-lg border border-white/10 bg-black/40 p-2 text-[10px] text-slate-200 space-y-2">
                            {status?.blocking.length ? (
                              <div>
                                <p className="text-[9px] uppercase tracking-widest text-ninpo-red">Blocking</p>
                                <ul className="mt-1 space-y-1">
                                  {status.blocking.map(message => (
                                    <li key={message} className="text-ninpo-red/80">
                                      {message}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {status?.advisory.length ? (
                              <div>
                                <p className="text-[9px] uppercase tracking-widest text-yellow-200">Advisory</p>
                                <ul className="mt-1 space-y-1">
                                  {status.advisory.map(message => (
                                    <li key={message} className="text-yellow-100/80">
                                      {message}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">Commit Summary</p>
                <p className="text-sm text-white font-semibold mt-2">{selectedForCommitCount} selected</p>
                <div className="mt-2 text-[10px] text-slate-400">Store: {activeStoreLabel || storeCandidateLabel}</div>

                <div className="mt-2">
                  <span className={`text-[9px] uppercase tracking-widest rounded-full border px-2 py-1 ${storeSummaryBadge.className}`}>
                    {storeSummaryBadge.label}
                  </span>
                </div>

                {finalStoreMode === 'MATCHED' && !storeCandidate?.storeId && (
                  <p className="mt-2 text-[10px] text-yellow-100/80">
                    No matched store found yet — confirm the candidate or switch to a draft store before approving.
                  </p>
                )}

                {(storeBlockingIssues.length > 0 || storeAdvisoryIssues.length > 0) && (
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3 text-[10px] text-slate-200 space-y-2">
                    {storeBlockingIssues.length > 0 && (
                      <div>
                        <p className="font-semibold text-ninpo-red uppercase tracking-widest text-[9px]">Store blocking</p>
                        <ul className="mt-1 space-y-1">
                          {storeBlockingIssues.map(issue => (
                            <li key={issue} className="text-ninpo-red/90">
                              {issue}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {storeAdvisoryIssues.length > 0 && (
                      <div>
                        <p className="font-semibold text-yellow-200 uppercase tracking-widest text-[9px]">Store advisory</p>
                        <ul className="mt-1 space-y-1">
                          {storeAdvisoryIssues.map(issue => (
                            <li key={issue} className="text-yellow-100/80">
                              {issue}
                            </li>
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
                      approvalMode === 'safe' ? 'border-white/50 text-white bg-white/20' : 'border-white/10 text-slate-300'
                    }`}
                  >
                    Safe
                  </button>
                  <button
                    onClick={() => onApprovalMode('selected')}
                    className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                      approvalMode === 'selected' ? 'border-white/50 text-white bg-white/20' : 'border-white/10 text-slate-300'
                    }`}
                  >
                    Selected
                  </button>
                  <button
                    onClick={() => onApprovalMode('locked')}
                    className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                      approvalMode === 'locked' ? 'border-white/50 text-white bg-white/20' : 'border-white/10 text-slate-300'
                    }`}
                  >
                    Locked
                  </button>
                  <button
                    onClick={() => onApprovalMode('all')}
                    className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                      approvalMode === 'all' ? 'border-white/50 text-white bg-white/20' : 'border-white/10 text-slate-300'
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
                    <input type="checkbox" checked={forceUpcOverride} onChange={event => onForceUpcOverride(event.target.checked)} />
                    Force UPC override when conflicts are found
                  </label>
                  {canOverridePriceLocks && (
                    <label className="flex items-center gap-2 text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={ignorePriceLocks}
                        onChange={event => onIgnorePriceLocks(event.target.checked)}
                      />
                      Ignore price locks for this approval (audit logged)
                    </label>
                  )}
                </div>

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
                                <li key={message} className="text-ninpo-red/80">
                                  {message}
                                </li>
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
                                <li key={message} className="text-yellow-100/80">
                                  {message}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <label className="mt-4 block text-[10px] text-slate-400 uppercase tracking-widest">
                  Manager notes
                  <textarea
                    value={approvalNotes}
                    onChange={event => onApprovalNotesChange(event.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white"
                    placeholder="Add any notes for this approval..."
                  />
                </label>

                <label className="mt-4 block text-[10px] text-slate-400 uppercase tracking-widest">
                  Idempotency key
                  <input
                    value={receiptApprovalIdempotencyKey}
                    onChange={event => onReceiptApprovalIdempotencyKeyChange(event.target.value)}
                    className="mt-2 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white"
                    placeholder="receipt-..."
                  />
                </label>

                <button
                  onClick={onCommit}
                  disabled={!approvalMode || isCommitting || receiptApprovalStatus.hasBlocking}
                  className="mt-4 hidden lg:block w-full px-4 py-3 rounded-2xl text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCommitting ? 'Approving…' : 'Approve & Apply'}
                </button>
                <p className="mt-2 text-[10px] text-slate-400">
                  Parse updates the <span className="font-semibold text-white">ReceiptParseJob</span> draft only. Approve &amp; Apply writes
                  <span className="font-semibold text-white"> StoreInventory</span> and <span className="font-semibold text-white">PriceObservation</span> records.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:hidden sticky bottom-0 border-t border-white/10 bg-ninpo-card/95 backdrop-blur px-6 py-4">
          <p className="mb-2 text-[10px] text-slate-400">
            Parse updates the <span className="font-semibold text-white">ReceiptParseJob</span> draft only. Approve &amp; Apply writes
            <span className="font-semibold text-white"> StoreInventory</span> and <span className="font-semibold text-white">PriceObservation</span>.
          </p>
          <button
            onClick={onCommit}
            disabled={!approvalMode || isCommitting || receiptApprovalStatus.hasBlocking}
            className="w-full px-4 py-3 rounded-2xl text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCommitting ? 'Approving…' : 'Approve & Apply'}
          </button>
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
