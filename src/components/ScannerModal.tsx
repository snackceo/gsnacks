import React from 'react';
import { createPortal } from 'react-dom';
// See GLOSSARY.md for authoritative definitions of all scanner modes.
import { ScannerMode } from '../types';
import ScannerPanel from './ScannerPanel';

interface ScannerModalProps {
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
  bottomSheetContent?: React.ReactNode;

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
  bottomSheetContent,
  closeOnScan = false,
  manualStart = false
}) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[14000]">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full flex-col">
        <ScannerPanel
          mode={mode}
          onScan={onScan}
          onCooldown={onCooldown}
          onClose={onClose}
          showClose
          title={title}
          subtitle={subtitle}
          beepEnabled={beepEnabled}
          cooldownMs={cooldownMs}
          onPhotoCaptured={onPhotoCaptured}
          closeOnScan={closeOnScan}
          manualStart={manualStart}
          className={`relative w-full flex-1 ${bottomSheetContent ? 'rounded-b-none' : ''}`}
        />

        {bottomSheetContent ? (
          <div className="relative z-10 w-full max-h-[45vh] overflow-y-auto rounded-t-[2.5rem] border-t border-white/10 bg-ninpo-black/95 p-6 shadow-2xl">
            <div className="mx-auto h-1 w-12 rounded-full bg-white/20" />
            <div className="mt-6 space-y-6">{bottomSheetContent}</div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
};

export default ScannerModal;
