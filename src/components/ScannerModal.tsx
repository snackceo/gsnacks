import React from 'react';
import { createPortal } from 'react-dom';
// See GLOSSARY.md for authoritative definitions of all scanner modes.
import { ScannerMode } from '../types';
import ScannerPanel, { ParsedReceiptItem } from './ScannerPanel';

export interface ScannerModalProps {
  mode?: ScannerMode;
  onScan: (upc: string) => void;
  onCooldown?: (upc: string, reason: 'cooldown' | 'duplicate') => void;
  onClose: () => void;
  title: string;
  subtitle: string;
  beepEnabled?: boolean;
  cooldownMs?: number;
  isOpen?: boolean;
  onPhotoCaptured?: (photoDataUrl: string, mime: string) => void;
  onReceiptParsed?: (items: ParsedReceiptItem[], frame?: string) => void;
  onModeChange?: (mode: ScannerMode) => void;
  bottomSheetContent?: React.ReactNode;
  receiptHeaderContent?: React.ReactNode;
  receiptSaveDisabled?: boolean;
  receiptSaveDisabledReason?: string;

  /**
   * Optional: if true, the modal closes after a successful scan.
   * Defaults to false to avoid surprising behavior.
   */
  closeOnScan?: boolean;

  /**
   * Optional: if true, the scanner will NOT auto-start; user must press Retry/Start.
   * Defaults to false.
   */
  manualStart?: boolean;
}


const ScannerModal: React.FC<ScannerModalProps> = ({
  mode,
  onScan,
  onCooldown,
  onClose,
  title,
  subtitle,
  beepEnabled = true,
  cooldownMs = 1200,
  isOpen = false,
  onPhotoCaptured,
  onReceiptParsed,
  onModeChange,
  bottomSheetContent,
  receiptHeaderContent,
  receiptSaveDisabled = false,
  receiptSaveDisabledReason,
  closeOnScan = false,
  manualStart = false
}) => {
  React.useEffect(() => {
    if (isOpen) document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, [isOpen]);
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[90dvh] bg-ninpo-black border border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-ninpo-black border-b border-white/10 px-4 py-3 flex items-center justify-between">
          <div className="text-white font-black">{title}</div>
          <button className="px-3 py-2 rounded-xl border border-white/10" onClick={onClose}>
            ✕
          </button>
        </div>
        {/* Body */}
        <div className="modal-body overflow-y-auto px-4 py-4 flex-1" style={{ maxHeight: 'calc(100dvh - 140px)' }}>
          <ScannerPanel
            mode={mode}
            onScan={onScan}
            onCooldown={onCooldown}
            onClose={onClose}
            showClose={false}
            title={title}
            subtitle={subtitle}
            beepEnabled={beepEnabled}
            cooldownMs={cooldownMs}
            onPhotoCaptured={onPhotoCaptured}
            onReceiptParsed={onReceiptParsed}
            onModeChange={onModeChange}
            closeOnScan={closeOnScan}
            manualStart={manualStart}
            receiptHeaderContent={receiptHeaderContent}
            receiptSaveDisabled={receiptSaveDisabled}
            receiptSaveDisabledReason={receiptSaveDisabledReason}
            bottomSheetContent={bottomSheetContent}
            className=""
          />
        </div>
        {/* Footer (optional, can add actions here if needed) */}
      </div>
    </div>,
    document.body
  );
};

export default ScannerModal;
