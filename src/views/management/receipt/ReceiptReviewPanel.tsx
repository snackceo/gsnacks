
import React from 'react';
import ReceiptItemBucket from '../../../components/ReceiptItemBucket';
import ScannerModal from '../../../components/ScannerModal';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { ScannerMode } from '../../../types';

interface ReceiptReviewPanelProps {
  activeReceiptCaptureId: string;
  classifiedItems: any[];
  commitIntent: 'safe' | 'selected' | 'locked' | null;
  isCommitting: boolean;
  lockDurationDays: number;
  selectedItemsForCommit: Map<string, boolean>;
  show: boolean;
  onClose: () => void;
  onParse: () => void;
  onConfirmAll: () => void;
  onResetReview: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onCommitMode: (mode: 'safe' | 'selected' | 'locked') => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onCommit: () => void;
  onConfirmItem: (item: any) => void;
  onScanItem: (item: any) => void;
  onSearchProduct: (item: any) => void;
  onCreateProduct: (item: any) => void;
  onSelectForCommit: (item: any) => void;
  onAddNoiseRule: (normalizedName: string) => void;
  scanModalOpen: boolean;
  scanTargetItem: any;
  handleScannerScan: (upc: string) => void;
  handleScannerClose: () => void;
  settings: any;
}

const ReceiptReviewPanel: React.FC<ReceiptReviewPanelProps> = ({
  activeReceiptCaptureId,
  classifiedItems,
  commitIntent,
  isCommitting,
  lockDurationDays,
  selectedItemsForCommit,
  show,
  onClose,
  onParse,
  onConfirmAll,
  onResetReview,
  onLock,
  onUnlock,
  onCommitMode,
  onSelectAll,
  onClearSelection,
  onCommit,
  onConfirmItem,
  onScanItem,
  onSearchProduct,
  onCreateProduct,
  onSelectForCommit,
  onAddNoiseRule,
  scanModalOpen,
  scanTargetItem,
  handleScannerScan,
  handleScannerClose,
  settings
}) => {
  if (!show) return null;
  const selectedForCommitCount = selectedItemsForCommit.size;
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
              Confirm All
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
                (Array.isArray(classifiedItems) ? classifiedItems : []).map((item, idx) => (
                  <ReceiptItemBucket
                    key={`${item.captureId}:${item.lineIndex ?? idx}`}
                    item={item}
                    onConfirm={onConfirmItem}
                    onScan={onScanItem}
                    onSearchProduct={() => onSearchProduct(item)}
                    onCreateProduct={() => onCreateProduct(item)}
                    onSelectForCommit={() => onSelectForCommit(item)}
                    selectedForCommit={selectedItemsForCommit.has(item.lineIndex?.toString?.() || idx.toString())}
                    onAddNoiseRule={() => onAddNoiseRule(item.normalizedName || '')}
                  />
                ))
              )}
            </div>

            <div className="space-y-4">
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">Commit Summary</p>
                <p className="text-sm text-white font-semibold mt-2">{selectedForCommitCount} selected</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => onCommitMode('safe')}
                    className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                      commitIntent === 'safe'
                        ? 'border-white/50 text-white bg-white/20'
                        : 'border-white/10 text-slate-300'
                    }`}
                  >
                    Safe
                  </button>
                  <button
                    onClick={() => onCommitMode('selected')}
                    className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                      commitIntent === 'selected'
                        ? 'border-white/50 text-white bg-white/20'
                        : 'border-white/10 text-slate-300'
                    }`}
                  >
                    Selected
                  </button>
                  <button
                    onClick={() => onCommitMode('locked')}
                    className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                      commitIntent === 'locked'
                        ? 'border-white/50 text-white bg-white/20'
                        : 'border-white/10 text-slate-300'
                    }`}
                  >
                    Locked
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

                <button
                  onClick={onCommit}
                  disabled={!commitIntent || isCommitting}
                  className="mt-4 w-full px-4 py-3 rounded-2xl text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCommitting ? 'Committing…' : 'Commit Items'}
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
