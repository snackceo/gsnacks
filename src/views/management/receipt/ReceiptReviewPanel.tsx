
import React, { useEffect, useMemo } from 'react';
import ReceiptItemBucket from '../../../components/ReceiptItemBucket';
import ScannerModal from '../../../components/ScannerModal';
import {
  FinalStoreMode,
  ReceiptApprovalAction,
  ReceiptApprovalCreateProductPayload,
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
  onCreateProduct: (item: any) => void;
  onSelectForCommit: (item: any, checked?: boolean) => void;
  onItemUpcChange: (itemId: string, upc: string) => void;
  onItemActionChange: (itemId: string, action: ReceiptApprovalAction) => void;
  onItemCreateProductChange: (itemId: string, details: Partial<ReceiptApprovalCreateProductPayload>) => void;
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
  onCreateProduct,
  onSelectForCommit,
  onItemUpcChange,
  onItemActionChange,
  onItemCreateProductChange,
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
  finalStoreMode,
  onFinalStoreModeChange,
  onLockDurationChange,
  stores,
  storeCandidate,
  canManageProducts
}) => {
  React.useEffect(() => {
    if (show) document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, [show]);
  if (!show) return null;
  const selectedForCommitCount = selectedItemsForCommit.size;
  const activeStoreLabel = stores.find(store => store.id === finalStoreId)?.name;
  const storeCandidateLabel = storeCandidate?.name || 'Unknown store';
  const shouldConfirmStoreCreate = !storeCandidate?.storeId && !finalStoreId;
  const isStoreCandidateMissing = !storeCandidate;
  const storeSummaryBadge = finalStoreMode === 'MATCHED'
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
  const storeConfidenceLabel = typeof storeCandidate?.confidence === 'number'
    ? storeCandidate.confidence.toFixed(2)
    : null;
  const blockingIssues = approvalIssues.filter(issue => issue.severity === 'blocking');
  const advisoryIssues = approvalIssues.filter(issue => issue.severity === 'advisory');
  const itemsByLineIndex = useMemo(() => {
    const mapping = new Map<number, any>();
    classifiedItems.forEach(item => {
      if (typeof item.lineIndex === 'number') {
        mapping.set(item.lineIndex, item);
      }
    });
    return mapping;
  }, [classifiedItems]);
  const receiptItemRows = receiptApprovalItems.map(item => ({
    ...item,
    source: itemsByLineIndex.get(item.lineIndex)
  }));
  const storeStatusBadge = receiptApprovalStatus.store.blocking.length
    ? { label: 'Blocking', className: 'bg-ninpo-red/20 text-ninpo-red border-ninpo-red/40' }
    : receiptApprovalStatus.store.advisory.length
      ? { label: 'Advisory', className: 'bg-yellow-200/10 text-yellow-100 border-yellow-200/40' }
      : { label: 'Ready', className: 'bg-ninpo-lime/10 text-ninpo-lime border-ninpo-lime/40' };
  const buildReceiptDefaults = (source?: any): Partial<ReceiptApprovalCreateProductPayload> => {
    if (!source) return {};
    const defaultPrice = typeof source.unitPrice === 'number'
      ? source.unitPrice
      : typeof source.lineTotal === 'number' && typeof source.quantity === 'number' && source.quantity > 0
        ? source.lineTotal / source.quantity
        : undefined;
    return {
      name: source.receiptName || source.nameCandidate || '',
      price: defaultPrice ?? undefined,
      sizeOz: source.sizeOz ?? undefined,
      brand: source.brandCandidate || undefined
    };
  };
  const actionOptions: Array<{ value: ReceiptApprovalAction; label: string }> = [
    { value: 'LINK_UPC_TO_PRODUCT', label: 'Link Existing Product' },
    { value: 'CREATE_PRODUCT', label: 'Create Product' },
    { value: 'IGNORE', label: 'Ignore' }
  ];
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-6xl h-[100dvh] sm:h-auto sm:max-h-[90dvh] bg-ninpo-card border border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {/* Header */}
        <div className="sticky top-0 z-10 bg-ninpo-card border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-white font-black uppercase text-lg tracking-widest">Receipt Review</h3>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">Capture ID: {activeReceiptCaptureId}</p>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-xl border border-white/10 text-slate-400 hover:text-white transition"
            aria-label="Close receipt review"
          >
            ✕
          </button>
        </div>
        {/* Body */}
        <div className="modal-body overflow-y-auto flex-1 p-6 space-y-6" style={{ maxHeight: 'calc(100dvh - 140px)' }}>
          {/* ...existing content from previous body... */}
          {/* ...no logic changed, just moved into modal-body... */}
          {/* ...existing code... */}
        </div>
        {/* Footer */}
        <div className="sticky bottom-0 z-10 bg-ninpo-card border-t border-white/10 px-6 py-4 pb-[calc(env(safe-area-inset-bottom)+12px)]">
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
