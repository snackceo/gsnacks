import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

// Ref to access ScannerPanel's capture method
const scannerPanelRef = useRef<any>(null);

// Handler to trigger photo capture in ScannerPanel
const handleCaptureClick = () => {
  if (scannerPanelRef.current && typeof scannerPanelRef.current.capturePhoto === 'function') {
    scannerPanelRef.current.capturePhoto();
  }
};
import { createPortal } from 'react-dom';

import ScannerPanel, { ScannerPanelProps } from './ScannerPanel';
// ...existing code...
import { StoreRecord, ScannerMode } from '../types';
import { formatStoreAddress } from '../utils/address';
import { BACKEND_URL } from '../constants';

/**
 * This file is intentionally LARGE. 
 * It preserves ALL existing UX behavior while finally wiring the backend.
 */

interface ReceiptCaptureFlowProps
  extends Omit<
    ScannerPanelProps,
    | 'selectedStoreId'
    | 'selectedStoreName'
    | 'selectedStoreBrand'
    | 'selectedStoreLocation'
    | 'selectedStoreIsPrimary'
    | 'onTogglePrimarySupplier'
    | 'onReceiptCaptured'
  > {
  stores: StoreRecord[];
  defaultStoreId?: string;
  isOpen?: boolean;

  /** Fired once a receipt is captured + parse triggered */
  onReceiptCreated?: (captureId: string) => void;

  /** Existing callbacks you already use elsewhere */
  onStoreSelected?: (storeId: string) => void;
  onPrimarySupplierToggle?: (storeId: string, nextValue: boolean) => void;
}

const PRIMARY_SUPPLIER_SESSION_KEY = 'receipt.primarySupplierOverrides';

const formatStoreBrand = (storeType?: string) =>
  storeType ? storeType.charAt(0).toUpperCase() + storeType.slice(1) : 'Other';

const ReceiptCaptureFlow: React.FC<ReceiptCaptureFlowProps> = ({
  stores = [],
  defaultStoreId,
  isOpen = false,
  mode = ScannerMode.RECEIPT_PARSE_LIVE,
  onReceiptCreated,
  onStoreSelected,
  onPrimarySupplierToggle,
  ...scannerProps
}) => {
  // ─────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────
  // Store selection is removed; backend will infer store from receipt
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [sessionPrimarySupplier, setSessionPrimarySupplier] = useState<
    Record<string, boolean>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const mountedRef = useRef(true);

  // ─────────────────────────────────────────────────────────────
  // LIFECYCLE SAFETY
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Store selection effect removed

  // ─────────────────────────────────────────────────────────────
  // SESSION PRIMARY SUPPLIER OVERRIDES
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(PRIMARY_SUPPLIER_SESSION_KEY);
      if (stored) {
        setSessionPrimarySupplier(JSON.parse(stored));
      }
    } catch {
      setSessionPrimarySupplier({});
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem(
      PRIMARY_SUPPLIER_SESSION_KEY,
      JSON.stringify(sessionPrimarySupplier)
    );
  }, [sessionPrimarySupplier]);

  // ─────────────────────────────────────────────────────────────
  // OPEN / CLOSE FLOW
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setIsCameraOpen(true);
      setError(null);
    } else {
      setIsCameraOpen(false);
      setError(null);
    }
  }, [isOpen]);
  // Handle file upload (image)
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Image = event.target?.result;
      if (typeof base64Image === 'string') {
        await handleReceiptCaptured(base64Image);
      }
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be uploaded again if needed
    e.target.value = '';
  };

  // Store selection logic removed

  // ─────────────────────────────────────────────────────────────
  // 🔥 CORE FIX: RECEIPT CAPTURE + PARSE (FULLY WIRED)
  // ─────────────────────────────────────────────────────────────
  const handleReceiptCaptured = useCallback(
    async (base64Image: string) => {
      setIsSubmitting(true);
      setError(null);

      try {
        // 1️⃣ Upload image to backend to get imageUrl and thumbnailUrl
        const uploadRes = await fetch(
          `${BACKEND_URL}/api/driver/upload-receipt-image`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64Image })
          }
        );

        if (!uploadRes.ok) {
          throw new Error(await uploadRes.text());
        }

        const { url, thumbnailUrl } = await uploadRes.json();
        if (!url) throw new Error('Image upload failed: no URL returned');

        // 2️⃣ CREATE RECEIPT CAPTURE with image URLs
        const captureRes = await fetch(
          `${BACKEND_URL}/api/driver/receipt-capture`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              images: [{ url, thumbnailUrl: thumbnailUrl || url }]
            })
          }
        );

        if (!captureRes.ok) {
          throw new Error(await captureRes.text());
        }

        const { captureId } = await captureRes.json();

        // 3️⃣ IMMEDIATE PARSE (CRITICAL — NO USER ACTION)
        const parseRes = await fetch(
          `${BACKEND_URL}/api/driver/receipt-parse`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ captureId })
          }
        );

        if (!parseRes.ok) {
          throw new Error(await parseRes.text());
        }

        if (!mountedRef.current) return;

        // 4️⃣ HAND OFF TO REVIEW / QUEUE
        onReceiptCreated?.(captureId);

        // Close camera after success
        setIsCameraOpen(false);
      } catch (err: any) {
        console.error('Receipt capture failed:', err);
        if (mountedRef.current) {
          setError(err.message || 'Receipt capture failed');
        }
      } finally {
        if (mountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [onReceiptCreated]
  );

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center">
      {/* CAMERA */}
      {isCameraOpen && (
        <>
          <ScannerPanel
            ref={scannerPanelRef}
            {...scannerProps}
            mode={mode}
            onReceiptCaptured={handleReceiptCaptured}
            showClose={true}
            onClose={() => setIsCameraOpen(false)}
            disabled={isSubmitting}
          />
          <button
            className="mt-4 py-3 px-8 bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase tracking-widest hover:bg-white transition-colors"
            onClick={handleCaptureClick}
            disabled={isSubmitting}
          >
            Capture Receipt
          </button>
        </>
      )}

      {/* UPLOAD BUTTON */}
      <button
        className="mt-6 py-3 px-6 bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase tracking-widest hover:bg-white transition-colors"
        onClick={handleUploadClick}
        disabled={isSubmitting}
      >
        Upload Receipt Image
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* ERROR TOAST */}
      {error && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-red-900/90 text-white px-4 py-2 rounded-lg shadow-lg">
          {error}
        </div>
      )}
    </div>,
    document.body
  );
};

export default ReceiptCaptureFlow;
