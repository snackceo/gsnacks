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
  closeOnScan = false,
  manualStart = false
}) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[14000] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
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
        className="relative w-full max-w-lg"
      />
    </div>,
    document.body
  );
};

export default ScannerModal;
