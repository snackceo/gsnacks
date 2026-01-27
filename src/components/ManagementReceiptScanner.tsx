import React, { useState, useEffect, useRef, FormEvent } from 'react';
// Helper to upload image to backend
async function uploadReceiptImage(file: File, captureId: string): Promise<void> {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('captureId', captureId);
  const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });
  if (!resp.ok) throw new Error('Failed to upload receipt image');
}
import { Check, X, Camera, AlertTriangle, Package } from 'lucide-react';
import { BACKEND_URL } from '../constants';

interface ReceiptImage {
  url: string;
  thumbnailUrl: string;
  uploadedAt: string;
  sequence: number;
}

interface DraftItem {
  lineIndex: number;
  receiptName: string;
  normalizedName: string;
  totalPrice: number;
  quantity: number;
  unitPrice: number;
  suggestedProduct?: {
    id: string;
    name: string;
    upc?: string;
    sku?: string;
  };
  matchMethod?: string;
  matchConfidence?: number;
  needsReview?: boolean;
  reviewReason?: string;
  boundProductId?: string;
  boundUpc?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  promoDetected?: boolean;
  priceType?: string;
  workflowType?: 'new_product' | 'update_price'; // NEW: workflow classification
}

interface ReceiptCapture {
  _id: string;
  storeId?: string;
  storeName?: string;
  orderId?: string;
  status: string;
  images: ReceiptImage[];
  draftItems: DraftItem[];
  stats: {
    totalItems: number;
    itemsNeedingReview: number;
    itemsConfirmed: number;
    itemsCommitted: number;
  };
  parseError?: string;
  createdAt: string;
  reviewExpiresAt?: string;
}

interface ManagementReceiptScannerProps {
  captureId: string;
  onClose: () => void;
  onCommit?: () => void;
}

export default function ManagementReceiptScanner({ captureId, onClose, onCommit }: ManagementReceiptScannerProps) {
  const [uploading, setUploading] = useState(false);
    // Handle file input change
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        await uploadReceiptImage(file, captureId);
        await fetchCapture();
      } catch (err: any) {
        setError(err.message || 'Failed to upload image');
      } finally {
        setUploading(false);
      }
    };
  const [capture, setCapture] = useState<ReceiptCapture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [scanningLineIndex, setScanningLineIndex] = useState<number | null>(null);
  const [scannedUpc, setScannedUpc] = useState('');
  const [committing, setCommitting] = useState(false);
  
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Fetch capture data
  const fetchCapture = async () => {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-capture/${captureId}`, {
        credentials: 'include'
      });
      
      if (!resp.ok) throw new Error('Failed to fetch receipt capture');
      
      const data = await resp.json();
      setCapture(data.capture);
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCapture();
    
    // Only refresh if not actively scanning - prevent polling from overwriting confirmations
    const interval = setInterval(() => {
      if (scanningLineIndex === null) {
        fetchCapture();
      }
    }, 5000); // Refresh every 5s (when not scanning)
    
    return () => clearInterval(interval);
  }, [captureId, scanningLineIndex]);

  // Auto-focus scan input when scanning mode enabled
  useEffect(() => {
    if (scanningLineIndex !== null && scanInputRef.current) {
      scanInputRef.current.focus();
    }
  }, [scanningLineIndex]);

  // Handle UPC scan
  const handleScanSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!scannedUpc || scanningLineIndex === null) return;

    try {
      // Lookup product by UPC
      const productResp = await fetch(`${BACKEND_URL}/api/driver/products?upc=${scannedUpc}`, {
        credentials: 'include'
      });
      
      if (!productResp.ok) {
        setError('Product not found');
        return;
      }
      
      const productData = await productResp.json();
      if (!productData.product) {
        setError('Product not found');
        return;
      }

      // Confirm item binding
      const confirmResp = await fetch(`${BACKEND_URL}/api/driver/receipt-confirm-item`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          captureId,
          lineIndex: scanningLineIndex,
          productId: productData.product._id,
          upc: scannedUpc
        })
      });

      if (!confirmResp.ok) throw new Error('Failed to confirm item');

      // Beep on success
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      oscillator.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.1);

      // Reset and refresh
      setScannedUpc('');
      setScanningLineIndex(null);
      await fetchCapture();

    } catch (err: any) {
      setError(err.message);
    }
  };

  // Handle skip item
  const handleSkip = (lineIndex: number) => {
    // Just move to next item
    setScanningLineIndex(null);
  };

  // Handle parse receipt with Gemini
  const handleParse = async () => {
    if (!capture || capture.status !== 'pending_parse') {
      setError('Receipt must be pending parse');
      return;
    }

    setParsing(true);
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-parse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ captureId })
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to parse receipt');
      }

      // Refresh to get parsed items
      await fetchCapture();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setParsing(false);
    }
  };

  // Handle commit to StoreInventory
  const handleCommit = async () => {
    if (!capture || capture.status !== 'review_complete') {
      setError('All items must be confirmed before commit');
      return;
    }

    setCommitting(true);
    try {
      const idempotencyKey = `rcpt-commit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      
      const resp = await fetch(`${BACKEND_URL}/api/receipts/${captureId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          captureId,
          storeId: capture.storeId,
          storeName: capture.storeName,
          idempotencyKey,
          finalStoreId: capture.storeId || undefined
        })
      });

      if (!resp.ok) throw new Error('Failed to commit receipt');

      await fetchCapture();
      if (onCommit) onCommit();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('receipt-queue-refresh'));
      }
      
      // Auto-close after commit
      setTimeout(onClose, 1500);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading receipt...</p>
        </div>
      </div>
    );
  }

  if (error && !capture) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md">
          <div className="text-red-600 mb-4">{error}</div>
          <button onClick={onClose} className="w-full bg-gray-200 text-gray-800 py-2 rounded">
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!capture) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Camera className="w-6 h-6" />
                Receipt Scanner - {capture.storeName}
              </h2>
              <p className="text-sm text-indigo-100 mt-1">
                Status: {capture.status} • {capture.stats.itemsConfirmed}/{capture.stats.totalItems} confirmed
              </p>
            </div>
            <button onClick={onClose} className="text-white hover:bg-white/20 rounded p-2">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 m-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <p className="text-red-800">{error}</p>
            </div>
          </div>
        )}

        {/* Receipt images and upload */}
        <div className="px-6 py-4 border-b bg-gray-50">
          <div className="flex gap-2 overflow-x-auto">
            {capture.images.map((img: ReceiptImage, idx: number) => (
              <img
                key={idx}
                src={img.thumbnailUrl}
                alt={`Receipt ${idx + 1}`}
                className="h-32 object-contain border border-gray-300 rounded cursor-pointer hover:opacity-75"
                onClick={() => window.open(img.url, '_blank')}
              />
            ))}
          </div>
          <div className="mt-4 flex gap-4 items-center">
            <label className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg cursor-pointer transition-all">
              {uploading ? 'Uploading...' : 'Capture/Upload Receipt'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                disabled={uploading}
                style={{ display: 'none' }}
              />
            </label>
            <span className="text-xs text-gray-500">Add a new receipt image</span>
          </div>
        </div>

        {/* Draft items table */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {capture.draftItems.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Package className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>No items parsed yet</p>
              {(capture.status === 'pending_parse' || capture.status === 'failed') && (
                <div className="mt-6">
                  <p className="text-sm mb-4">Click the button below to extract items using Gemini Vision</p>
                  <button
                    onClick={handleParse}
                    disabled={parsing}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-bold py-2 px-6 rounded-lg transition-all"
                  >
                    {parsing ? 'Parsing with Gemini...' : 'Parse Receipt with Gemini'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2 text-sm font-semibold text-gray-700">#</th>
                  <th className="text-left px-4 py-2 text-sm font-semibold text-gray-700">Receipt Name</th>
                  <th className="text-right px-4 py-2 text-sm font-semibold text-gray-700">Qty</th>
                  <th className="text-right px-4 py-2 text-sm font-semibold text-gray-700">Unit Price</th>
                  <th className="text-left px-4 py-2 text-sm font-semibold text-gray-700">Match</th>
                  <th className="text-center px-4 py-2 text-sm font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody>
                {capture.draftItems.map((item: DraftItem) => {
                  const isScanning = scanningLineIndex === item.lineIndex;
                  const isConfirmed = !!item.confirmedAt;
                  
                  return (
                    <tr
                      key={item.lineIndex}
                      className={`border-b ${
                        isConfirmed ? 'bg-green-50' :
                        item.needsReview ? 'bg-yellow-50' :
                        'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-4 py-3 text-sm">{item.lineIndex + 1}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium">{item.receiptName}</div>
                        <div className="flex items-center gap-2 mt-1">
                          {item.workflowType === 'new_product' ? (
                            <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded font-semibold">
                              CREATE PRODUCT
                            </span>
                          ) : (
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-semibold">
                              UPDATE PRICE
                            </span>
                          )}
                        </div>
                        {item.suggestedProduct && (
                          <div className="text-xs text-gray-600 mt-1">
                            Suggested: {item.suggestedProduct.name}
                            {item.matchConfidence && (
                              <span className="ml-2 text-indigo-600">
                                ({Math.round(item.matchConfidence * 100)}%)
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-sm">{item.quantity}</td>
                      <td className="px-4 py-3 text-right text-sm font-medium">
                        ${item.unitPrice.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {isConfirmed ? (
                          <div className="text-green-600 flex items-center gap-1">
                            <Check className="w-4 h-4" />
                            Confirmed
                          </div>
                        ) : item.needsReview ? (
                          <div className="text-yellow-600 text-xs">
                            {item.reviewReason?.replace(/_/g, ' ')}
                          </div>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isConfirmed ? (
                          <div className="text-center text-green-600">✓</div>
                        ) : isScanning ? (
                          <form onSubmit={handleScanSubmit} className="flex gap-2">
                            <input
                              ref={scanInputRef}
                              type="text"
                              value={scannedUpc}
                              onChange={(e) => setScannedUpc(e.target.value)}
                              placeholder="Scan UPC..."
                              className="border rounded px-2 py-1 text-sm w-32"
                            />
                            <button
                              type="submit"
                              className="bg-green-500 text-white px-3 py-1 rounded text-sm hover:bg-green-600"
                            >
                              OK
                            </button>
                            <button
                              type="button"
                              onClick={() => setScanningLineIndex(null)}
                              className="bg-gray-300 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-400"
                            >
                              ✕
                            </button>
                          </form>
                        ) : (
                          <div className="flex gap-2 justify-center">
                            <button
                              onClick={() => setScanningLineIndex(item.lineIndex)}
                              className="bg-indigo-500 text-white px-3 py-1 rounded text-sm hover:bg-indigo-600"
                            >
                              Scan
                            </button>
                            <button
                              onClick={() => handleSkip(item.lineIndex)}
                              className="bg-gray-300 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-400"
                            >
                              Skip
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 bg-gray-50 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="text-sm text-gray-600">
            {capture.stats.itemsConfirmed} of {capture.stats.totalItems} items confirmed
            {capture.reviewExpiresAt && (
              <span className="ml-4 text-yellow-600">
                Expires: {new Date(capture.reviewExpiresAt).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="flex gap-3 flex-wrap items-center">
            <label className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg cursor-pointer transition-all mb-0">
              {uploading ? 'Uploading...' : 'Capture/Upload Receipt'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                disabled={uploading}
                style={{ display: 'none' }}
              />
            </label>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
            >
              Close
            </button>
            {capture.status === 'review_complete' && (
              <button
                onClick={handleCommit}
                disabled={committing}
                className="px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded font-semibold hover:from-green-600 hover:to-emerald-700 disabled:opacity-50"
              >
                {committing ? 'Committing...' : 'Commit to Inventory'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
