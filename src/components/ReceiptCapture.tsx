import React, { useCallback, useMemo, useState } from 'react';
import { Camera, Plus, X, Package, Check, AlertCircle, Upload } from 'lucide-react';
import { receiptApiClient } from '../api/receiptApiClient';

const GATE_ERROR_STATUSES = new Set([403, 429, 503]);

const getGateErrorMessage = (err: any, fallback: string) => {
  const status = Number(err?.status);
  if (GATE_ERROR_STATUSES.has(status)) {
    return err?.data?.error || err?.message || fallback;
  }
  return err?.message || fallback;
};

interface ReceiptItem {
  upc?: string;
  sku?: string;
  name: string; // Receipt line description for fuzzy matching
  totalPrice: number;
  quantity: number;
  packSize?: number;
  autoMatched?: boolean; // Was this auto-matched from previous binding?
}

interface ReceiptCaptureProps {
  orderId: string;
  storeId?: string;
  storeName?: string;
  onComplete: () => void;
  onCancel: () => void;
}

const PDF_UPLOAD_MESSAGE = 'PDF upload coming soon.';

const ReceiptCapture: React.FC<ReceiptCaptureProps> = ({
  orderId,
  storeId,
  storeName,
  onComplete,
  onCancel
}) => {
  const [receiptPhoto, setReceiptPhoto] = useState<string | null>(null);
  const [receiptPhotoMime, setReceiptPhotoMime] = useState('image/jpeg');
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [currentItem, setCurrentItem] = useState<Partial<ReceiptItem>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [scanningForIndex, setScanningForIndex] = useState<number | null>(null);
  const [upcScanInput, setUpcScanInput] = useState('');
  const [reviewItems, setReviewItems] = useState<any[]>([]);
  const [keepScannerOpen, setKeepScannerOpen] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<'queued' | 'parsing' | 'failed' | null>(null);
  const [parseRetryCaptureId, setParseRetryCaptureId] = useState<string | null>(null);
  const [isParseRetrying, setIsParseRetrying] = useState(false);

  const storeLabel = useMemo(() => storeName || storeId || 'Unknown Store', [storeId, storeName]);

  const handlePhotoFile = useCallback((file: File) => {
    if (!file) return;

    if (file.type === 'application/pdf') {
      setError(PDF_UPLOAD_MESSAGE);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Unsupported file type. Please upload an image.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl) return;
      setReceiptPhoto(dataUrl);
      setReceiptPhotoMime(file.type || 'image/jpeg');
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePhotoCapture = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handlePhotoFile(file);
    }
    event.target.value = '';
  }, [handlePhotoFile]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      handlePhotoFile(file);
    }
  }, [handlePhotoFile]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  }, []);

  const handleAddItem = () => {
    if (!currentItem.totalPrice || !currentItem.quantity) {
      setError('Price and quantity are required');
      return;
    }

    if (!currentItem.name || currentItem.name.trim().length === 0) {
      setError('Product name/description is required for matching');
      return;
    }

    setItems([...items, currentItem as ReceiptItem]);
    setCurrentItem({});
    setError(null);
  };

  const playBeep = () => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.3;
    oscillator.start();
    setTimeout(() => oscillator.stop(), 100);
  };

  const handleScanUpc = (index: number, upc: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], upc: upc.trim() };
    setItems(updated);
    playBeep();

    if (keepScannerOpen) {
      setUpcScanInput('');
      // Keep scanner open for next item
    } else {
      setScanningForIndex(null);
      setUpcScanInput('');
    }
  };

  const handleUpcScanKeyPress = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter' && upcScanInput.trim()) {
      handleScanUpc(index, upcScanInput);
    }
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const generateCaptureId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const uploadReceiptImage = async () => {
    if (!receiptPhoto) return null;

    setUploadPhase('Uploading receipt image…');
    const uploadData = await receiptApiClient.uploadReceiptImage({
      image: receiptPhoto,
      storeId: storeId || undefined
    });

    return uploadData;
  };

  const createReceiptCapture = async (imageUrl: string, thumbnailUrl?: string) => {
    setUploadPhase('Creating receipt capture…');
    const captureRequestId = generateCaptureId();
    const data = await receiptApiClient.createCapture({
      storeId: storeId || undefined,
      storeName: storeName || undefined,
      orderId,
      captureRequestId,
      images: [
        {
          url: imageUrl,
          thumbnailUrl: thumbnailUrl || imageUrl,
          mime: receiptPhotoMime
        }
      ]
    });

    return data.captureId;
  };

  const triggerParse = async (captureId: string, options?: { isRetry?: boolean }) => {
    const { isRetry = false } = options || {};
    if (isRetry) {
      setIsParseRetrying(true);
    }

    try {
      setParseStatus('queued');
      await receiptApiClient.triggerParse(captureId);
      setParseStatus('parsing');

      setParseRetryCaptureId(null);
      return true;
    } catch (parseErr: any) {
      console.error('Receipt parse trigger failed:', { captureId, error: parseErr });
      setParseRetryCaptureId(captureId);
      setParseStatus('failed');
      setError(
        getGateErrorMessage(parseErr, 'Receipt auto-parse failed. Please try again or contact support.') +
          ' (Auto-parse error)'
      );
      return false;
    } finally {
      if (isRetry) {
        setIsParseRetrying(false);
      }
    }
  };

  const handleSubmit = async () => {
    if (items.length === 0) {
      setError('Add at least one item');
      return;
    }

    if (!storeId) {
      setError('A store must be selected before submitting.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setUploadPhase(null);
    setParseRetryCaptureId(null);
    setParseStatus(null);

    try {
      let receiptImageUrl: string | undefined;
      let receiptThumbnailUrl: string | undefined;
      let captureId = generateCaptureId();

      if (receiptPhoto) {
        const uploadData = await uploadReceiptImage();
        if (!uploadData?.url) {
          throw new Error('Receipt image upload failed');
        }
        receiptImageUrl = uploadData.url;
        receiptThumbnailUrl = uploadData.thumbnailUrl || uploadData.url;
        captureId = await createReceiptCapture(receiptImageUrl, receiptThumbnailUrl);
        
          // Canonical lifecycle invariant: capture -> immediate parse trigger -> poll -> approve/reject
          setUploadPhase('Parsing receipt with AI…');
          await triggerParse(captureId);
      }

      setUploadPhase('Submitting receipt items…');

      // The API expects one item at a time. We must iterate and call it for each.
      const results = await Promise.all(
        items.map(item =>
          receiptApiClient.priceUpdateManual({
            storeId,
            productId: item.sku || '', // Assuming SKU can be used as productId
            price: item.totalPrice,
            upc: item.upc,
            // Other metadata might be needed here depending on the final API design
            // but for now, we'll stick to what the type expects.
          })
        )
      );

      // Aggregate results for UI feedback
      const result = results.reduce((acc, res: any) => {
          acc.updated += res.updated || 0;
          acc.created += res.created || 0;
          acc.needsReview += res.needsReview || 0;
          if (res.errors) acc.errors.push(...res.errors);
          return acc;
      }, { updated: 0, created: 0, needsReview: 0, errors: [] });

      if (result.reviewItems && result.reviewItems.length > 0) {
        // Show review UI for confirmation
        setReviewItems(result.reviewItems);
        const stats = `${result.updated || 0} updated, ${result.created || 0} created, ${result.needsReview || 0} need review`;
        setError(stats);
      } else if (result.errors && result.errors.length > 0) {
        const stats = `${result.updated || 0} updated, ${result.created || 0} created${result.autoMatched ? `, ${result.autoMatched} auto-matched` : ''}`;
        setError(`${stats}. Errors: ${result.errors.slice(0, 3).join('; ')}`);
      } else {
        setSuccess(true);
        setTimeout(() => {
          onComplete();
        }, 2000);
      }
    } catch (err: any) {
      setError(getGateErrorMessage(err, 'Failed to submit receipt'));
    } finally {
      setSubmitting(false);
      setUploadPhase(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-ninpo-black border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-ninpo-black border-b border-white/10 p-6 flex items-center justify-between z-10">
          <div>
            <h2 className="text-2xl font-black text-ninpo-lime">Receipt Price Update</h2>
            <p className="text-sm text-white/60 mt-1">
              {storeLabel} • Order {orderId?.slice(0, 8)}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-white/10 rounded-lg transition-all"
          >
            <X className="w-6 h-6 text-white" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-900/20 border border-red-600 rounded-xl text-red-300 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                {error}
              </div>
              {parseRetryCaptureId && (
                <button
                  type="button"
                  onClick={() => triggerParse(parseRetryCaptureId, { isRetry: true })}
                  disabled={isParseRetrying}
                  className="self-start px-4 py-2 bg-white text-red-900 font-black uppercase tracking-widest rounded-full text-xs hover:bg-red-100 transition-colors disabled:opacity-60"
                >
                  {isParseRetrying ? 'Retrying parse…' : 'Parse failed — retry now'}
                </button>
              )}
            </div>
          )}

          {success && (
            <div className="p-4 bg-green-900/20 border border-green-600 rounded-xl text-green-300 flex items-center gap-2">
              <Check className="w-5 h-5" />
              Receipt submitted! Prices updated successfully.
            </div>
          )}

          {/* Receipt Photo */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <label className="flex items-center gap-2 text-sm font-bold text-white/70 mb-3">
              <Camera className="w-4 h-4" />
              Receipt Photo (Optional)
            </label>
            {receiptPhoto ? (
              <div className="relative">
                <img src={receiptPhoto} alt="Receipt" className="w-full rounded-lg" />
                <button
                  onClick={() => setReceiptPhoto(null)}
                  className="absolute top-2 right-2 p-2 bg-red-600 rounded-lg hover:bg-red-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label
                className={`flex flex-col items-center justify-center gap-2 h-48 border-2 border-dashed rounded-lg cursor-pointer transition-all text-center px-4 ${
                  isDragActive
                    ? 'border-ninpo-lime bg-ninpo-lime/10 text-ninpo-lime'
                    : 'border-white/20 text-white/60 hover:border-ninpo-lime/50'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <Camera className="w-8 h-8 text-white/40" />
                <span className="text-sm text-white/70">Drag & drop a receipt image</span>
                <span className="text-xs text-white/40">Or use the upload options below.</span>
                <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                  <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest bg-ninpo-lime text-ninpo-black">
                    <Upload className="w-3 h-3" />
                    Upload image
                  </span>
                  <button
                    type="button"
                    disabled
                    className="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest bg-white/5 text-white/40 border border-white/10 cursor-not-allowed"
                    title={PDF_UPLOAD_MESSAGE}
                  >
                    PDF (coming soon)
                  </button>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoCapture}
                  className="hidden"
                />
              </label>
            )}
            {uploadPhase && (
              <p className="mt-3 text-xs text-slate-300">{uploadPhase}</p>
            )}
            {parseStatus && (
              <p className="mt-2 text-xs text-blue-300">
                Parse status: {parseStatus}
              </p>
            )}
          </div>

          {/* Receipt Items */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <Package className="w-5 h-5 text-ninpo-lime" />
                Receipt Items ({items.length})
              </h3>
              <div className="flex items-center gap-2 text-xs text-white/50">
                <input
                  type="checkbox"
                  checked={keepScannerOpen}
                  onChange={e => setKeepScannerOpen(e.target.checked)}
                  className="rounded border-white/20"
                />
                Keep scanner open
              </div>
            </div>

            {items.length === 0 ? (
              <div className="text-center py-8 text-white/40">
                <Package className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No items added yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item, index) => (
                  <div key={index} className="bg-white/5 rounded-xl p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold text-white">{item.name}</p>
                        <p className="text-sm text-white/50">
                          ${item.totalPrice} × {item.quantity} = ${item.totalPrice * item.quantity}
                        </p>
                        {item.upc && (
                          <p className="text-xs text-ninpo-lime mt-1">UPC: {item.upc}</p>
                        )}
                        {item.autoMatched && (
                          <p className="text-xs text-blue-400 mt-1">Auto-matched</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveItem(index)}
                        className="p-1 hover:bg-red-500/20 rounded"
                      >
                        <X className="w-4 h-4 text-red-400" />
                      </button>
                    </div>

                    {!item.upc && (
                      <div className="mt-3">
                        {scanningForIndex === index ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={upcScanInput}
                              onChange={e => setUpcScanInput(e.target.value)}
                              onKeyPress={e => handleUpcScanKeyPress(e, index)}
                              placeholder="Scan or enter UPC"
                              className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white"
                            />
                            <button
                              onClick={() => handleScanUpc(index, upcScanInput)}
                              className="px-4 py-2 bg-ninpo-lime text-ninpo-black rounded-lg font-bold"
                            >
                              Set
                            </button>
                            {!keepScannerOpen && (
                              <button
                                onClick={() => setScanningForIndex(null)}
                                className="px-3 py-2 bg-white/10 text-white rounded-lg"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => setScanningForIndex(index)}
                            className="text-xs text-ninpo-lime hover:text-ninpo-lime/80 font-bold"
                          >
                            + Add UPC
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add New Item Form */}
            <div className="bg-white/5 rounded-xl p-4 space-y-4">
              <h4 className="font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-ninpo-lime" />
                Add Item
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-white/60">Product Name/Description *</label>
                  <input
                    type="text"
                    value={currentItem.name || ''}
                    onChange={e => setCurrentItem({ ...currentItem, name: e.target.value })}
                    placeholder="e.g. Coke 12pk"
                    className="w-full mt-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60">Total Price *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={currentItem.totalPrice || ''}
                    onChange={e => setCurrentItem({ ...currentItem, totalPrice: parseFloat(e.target.value) })}
                    placeholder="0.00"
                    className="w-full mt-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60">Quantity *</label>
                  <input
                    type="number"
                    value={currentItem.quantity || ''}
                    onChange={e => setCurrentItem({ ...currentItem, quantity: parseInt(e.target.value) })}
                    placeholder="1"
                    className="w-full mt-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60">Pack Size</label>
                  <input
                    type="number"
                    value={currentItem.packSize || ''}
                    onChange={e => setCurrentItem({ ...currentItem, packSize: parseInt(e.target.value) })}
                    placeholder="Optional"
                    className="w-full mt-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white"
                  />
                </div>
              </div>

              <button
                onClick={handleAddItem}
                className="w-full py-3 bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase tracking-widest hover:bg-ninpo-lime/90 transition-all"
              >
                Add Item
              </button>
              <p className="text-xs text-white/50 mt-1">Exact name from receipt helps auto-match future purchases</p>
            </div>
          </div>

          {/* Review Items */}
          {reviewItems.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-600 rounded-xl p-4">
              <h4 className="font-bold text-yellow-300 mb-3">Items Needing Review</h4>
              <div className="space-y-2">
                {reviewItems.map((review, index) => (
                  <div key={index} className="bg-black/30 rounded-lg p-3">
                    <p className="text-sm font-bold text-white mb-2">{review.receiptName}</p>
                    <p className="text-xs text-white/50 mb-3">Multiple matches found</p>
                    <div className="space-y-2">
                      {review.matches?.map((match: any, matchIndex: number) => (
                        <button
                          key={matchIndex}
                          onClick={async () => {
                            if (!storeId) {
                              setError('A store must be selected to confirm matches.');
                              return;
                            }
                            try {
                              await receiptApiClient.confirmMatch({
                                storeId,
                                productId: match.productId,
                                normalizedName: review.receiptName
                              });
                              setReviewItems(prev => prev.filter((_, i) => i !== index));
                              setError(null);
                            } catch {
                              setError('Failed to confirm match');
                            }
                          }}
                          className="w-full text-left p-2 bg-white/5 hover:bg-white/10 rounded text-xs text-white"
                        >
                          {match.name} (SKU: {match.sku})
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-black uppercase tracking-widest transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || items.length === 0}
              className="flex-1 py-3 bg-ninpo-lime text-ninpo-black hover:bg-white rounded-xl font-black uppercase tracking-widest transition-all disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Receipt'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReceiptCapture;
