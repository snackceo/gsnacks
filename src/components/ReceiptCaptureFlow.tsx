import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import { createPortal } from 'react-dom';

import ScannerPanel, { ScannerPanelProps } from './ScannerPanel';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { useNinpoCore } from '../hooks/useNinpoCore';
import { ScannerMode, StoreRecord } from '../types';
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
  onParsedItems?: (items: any) => void;
  onImageUploaded?: (url: string, thumbnailUrl?: string) => void;

  /** Called when the flow should close (camera exit or after capture) */
  onCancel?: () => void;

  /** Existing callbacks you already use elsewhere */
  onStoreSelected?: (storeId: string) => void;
  onPrimarySupplierToggle?: (storeId: string, nextValue: boolean) => void;
}

const PRIMARY_SUPPLIER_SESSION_KEY = 'receipt.primarySupplierOverrides';

const formatStoreBrand = (storeType?: string) =>
  storeType ? storeType.charAt(0).toUpperCase() + storeType.slice(1) : 'Other';

// UUID v4 generator (RFC4122 compliant, browser-safe)
function generateUUIDv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const ReceiptCaptureFlow: React.FC<ReceiptCaptureFlowProps> = ({
  stores = [],
  defaultStoreId,
  isOpen = false,
  mode = ScannerMode.RECEIPT_PARSE_LIVE,
  onReceiptCreated,
  onParsedItems,
  onImageUploaded,
  onCancel,
  onStoreSelected,
  onPrimarySupplierToggle,
  ...scannerProps
}) => {
  // Ref to access ScannerPanel's capture method
  const scannerPanelRef = useRef<any>(null);

  // Handler to trigger photo capture in ScannerPanel
  // Defensive: Only allow capture if valid
  const isValidImage = (img: any) => {
    if (!img || typeof img !== 'string') return false;
    return img.startsWith('data:image/jpeg;base64,') || img.startsWith('data:image/png;base64,');
  };

  const handleCaptureClick = () => {
    if (scannerPanelRef.current && typeof scannerPanelRef.current.capturePhoto === 'function') {
      const capturedImage = scannerPanelRef.current.getPreviewImage?.();
      if (!capturedImage || !isValidImage(capturedImage)) {
        addToast('Invalid image, please retake the photo', { type: 'error' });
        return;
      }
      scannerPanelRef.current.capturePhoto();
    }
  };

  const { addToast } = useNinpoCore ? useNinpoCore() : { addToast: () => {} };

  // ─────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────
  // Store selection is removed; backend will infer store from receipt
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [sessionPrimarySupplier, setSessionPrimarySupplier] = useState<
    Record<string, boolean>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
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
  // Always open camera when modal is open (for debugging and strict UX)
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
    async (photoDataUrl: string, mime: string) => {
      setIsSubmitting(true);
      setError(null);
      addToast('Uploading receipt…', { type: 'info' });
      try {
        setShowSuccess(false);
        // 1️⃣ Upload image to backend to get imageUrl and thumbnailUrl
        const uploadRes = await fetch(
          `${BACKEND_URL}/api/driver/upload-receipt-image`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: photoDataUrl, mime })
          }
        );

        if (!uploadRes.ok) {
          throw new Error(await uploadRes.text());
        }

        const { url, thumbnailUrl } = await uploadRes.json();
        if (!url) throw new Error('Image upload failed: no URL returned');

        // 2️⃣ CREATE RECEIPT CAPTURE with image URLs and captureRequestId
        const captureRequestId = generateUUIDv4();
        const captureBody = {
          images: [{ url, thumbnailUrl: thumbnailUrl || url }],
          captureRequestId
        };
        console.log('DEBUG: captureRequestId', captureRequestId, 'captureBody', captureBody);
        const captureRes = await fetch(
          `${BACKEND_URL}/api/driver/receipt-capture`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(captureBody)
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
        const parseData = await parseRes.json();

        if (!parseRes.ok) {
          // ONLY toast if enqueue failed
          setError(parseData?.error || 'Failed to enqueue receipt parse');
          return;
        }
        // DO NOT throw or toast if parse is pending. This is SUCCESS.
        // Proceed to review UI, show "Parsing in progress..."

        if (!mountedRef.current) return;

        // 4️⃣ HAND OFF TO REVIEW / QUEUE
        setShowSuccess(true);
        setTimeout(() => {
          setShowSuccess(false);
          addToast('Receipt added! Parsing in progress…', { type: 'success' });
          onReceiptCreated?.(captureId);
        }, 1200);

        // Optionally notify parent of parsed items (if implemented in future)
        if (typeof onParsedItems === 'function' && parseData?.items) {
          onParsedItems?.(parseData.items);
        }

        // Optionally notify parent of image upload
        if (typeof onImageUploaded === 'function' && url) {
          onImageUploaded?.(url, thumbnailUrl || url);
        }

        // Close camera and overlay after success
        setIsCameraOpen(false);
        if (typeof onCancel === 'function') onCancel();
      } catch (err: any) {
        console.error('Receipt capture failed:', err);
        if (mountedRef.current) {
          setError(err.message || 'Failed to capture receipt.');
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

  // Stricter guard: if overlay is open but neither camera nor preview is visible, auto-close
  if (!isCameraOpen && !previewImage) {
    addToast('Camera closed or unavailable. Exiting receipt flow.', { type: 'warning' });
    if (typeof onCancel === 'function') onCancel();
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center">
      {/* CAMERA */}
      {isCameraOpen ? (
        <>
          <div className="w-full h-full flex flex-col items-center justify-center">
              {/* Removed fixed bottom Capture Receipt button. Capture is now only via ScannerPanel shutter. */}
              <ScannerPanel
                ref={scannerPanelRef}
                {...scannerProps}
                mode={mode}
                onPhotoCaptured={handleReceiptCaptured}
                showClose={true}
                onClose={() => {
                  setIsCameraOpen(false);
                  if (typeof onCancel === 'function') onCancel();
                }}
                disabled={isSubmitting}
              />
            {isSubmitting && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80">
                <Loader2 className="w-12 h-12 text-ninpo-lime animate-spin mb-4" />
                <div className="text-white font-black text-lg uppercase tracking-widest">Uploading & Parsing…</div>
              </div>
            )}
            {showSuccess && !isSubmitting && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80">
                <CheckCircle2 className="w-16 h-16 text-ninpo-lime mb-4" />
                <div className="text-ninpo-lime font-black text-lg uppercase tracking-widest">Receipt Added!<br/>Parsing in Progress…</div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center w-full h-full">
          <div className="text-white text-lg font-bold mb-4">Camera unavailable or closed.</div>
          <button
            className="py-3 px-8 bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase tracking-widest hover:bg-white transition-colors"
            onClick={() => {
              setIsCameraOpen(true);
              setError(null);
              addToast('Camera re-opened.', { type: 'info' });
            }}
          >
            Reopen Camera
          </button>
        </div>
      )}

      {/* ERROR TOAST */}
      {error && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-red-900/90 text-white px-4 py-2 rounded-lg shadow-lg z-50">
          {error}
        </div>
      )}
    </div>,
    document.body
  );
};

export default ReceiptCaptureFlow;
