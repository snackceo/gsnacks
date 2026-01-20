import React, { useState } from 'react';
import { Camera, Plus, X, DollarSign, Package, Check, AlertCircle } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

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

const ReceiptCapture: React.FC<ReceiptCaptureProps> = ({
  orderId,
  storeId,
  storeName,
  onComplete,
  onCancel
}) => {
  const [receiptPhoto, setReceiptPhoto] = useState<string | null>(null);
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [currentItem, setCurrentItem] = useState<Partial<ReceiptItem>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [scanningForIndex, setScanningForIndex] = useState<number | null>(null);
  const [upcScanInput, setUpcScanInput] = useState('');
  const [reviewItems, setReviewItems] = useState<any[]>([]);
  const [keepScannerOpen, setKeepScannerOpen] = useState(false);

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setReceiptPhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

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

  const handleSubmit = async () => {
    if (items.length === 0) {
      setError('Add at least one item');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${BACKEND_URL}/api/driver/receipt-price-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          storeId,
          storeName,
          orderId,
          receiptPhoto,
          items
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit receipt');
      }

      const result = await res.json();
      
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
      setError(err.message || 'Failed to submit receipt');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-ninpo-black border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-ninpo-black border-b border-white/10 p-6 flex items-center justify-between z-10">
          <div>
            <h2 className="text-2xl font-black text-ninpo-lime">Receipt Price Update</h2>
            <p className="text-sm text-white/60 mt-1">
              {storeName || storeId} • Order {orderId?.slice(0, 8)}
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
            <div className="p-4 bg-red-900/20 border border-red-600 rounded-xl text-red-300 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              {error}
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
              <label className="flex flex-col items-center justify-center h-40 border-2 border-dashed border-white/20 rounded-lg cursor-pointer hover:border-ninpo-lime/50 transition-all">
                <Camera className="w-8 h-8 text-white/40 mb-2" />
                <span className="text-sm text-white/60">Tap to capture receipt</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoCapture}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Add Item Form */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h3 className="text-lg font-black text-white mb-4">Add Item</h3>
            <div className="grid grid-cols-1 gap-3 mb-3">
              <div>
                <label className="text-xs font-bold text-white/70 mb-1 block">Product Name / Description *</label>
                <input
                  type="text"
                  value={currentItem.name || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, name: e.target.value })}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white"
                  placeholder="e.g., Coca Cola 12pk or Great Value Milk"
                />
                <p className="text-xs text-white/50 mt-1">Exact name from receipt helps auto-match future purchases</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-white/70 mb-1 block">UPC (Optional - can scan later)</label>
                  <input
                    type="text"
                    value={currentItem.upc || ''}
                    onChange={(e) => setCurrentItem({ ...currentItem, upc: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white"
                    placeholder="012345678901"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-white/70 mb-1 block">SKU (Optional)</label>
                  <input
                    type="text"
                    value={currentItem.sku || ''}
                    onChange={(e) => setCurrentItem({ ...currentItem, sku: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white"
                    placeholder="SKU123"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-white/70 mb-1 block">Total Price *</label>
                <input
                  type="number"
                  step="0.01"
                  value={currentItem.totalPrice || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, totalPrice: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white"
                  placeholder="9.99"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-white/70 mb-1 block">Quantity *</label>
                <input
                  type="number"
                  value={currentItem.quantity || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, quantity: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white"
                  placeholder="1"
                />
              </div>
            </div>
            <button
              onClick={handleAddItem}
              className="w-full py-3 bg-ninpo-lime text-ninpo-black rounded-lg font-black uppercase tracking-widest hover:bg-white transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Add Item
            </button>
          </div>

          {/* Items List */}
          {items.length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <h3 className="text-lg font-black text-white mb-4 flex items-center gap-2">
                <Package className="w-5 h-5" />
                Items ({items.length})
              </h3>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex-1">
                        <p className="text-sm font-bold text-white">{item.name}</p>
                        <p className="text-xs text-white/60">
                          ${item.totalPrice.toFixed(2)} ÷ {item.quantity} = ${(item.totalPrice / item.quantity).toFixed(2)}/unit
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveItem(idx)}
                        className="p-2 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {scanningForIndex === idx ? (
                      <div className="space-y-2 mt-2">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={upcScanInput}
                            onChange={(e) => setUpcScanInput(e.target.value)}
                            onKeyPress={(e) => handleUpcScanKeyPress(e, idx)}
                            placeholder="Scan or enter UPC..."
                            autoFocus
                            className="flex-1 px-3 py-2 bg-white/10 border border-ninpo-lime rounded-lg text-white text-sm"
                          />
                          <button
                            onClick={() => handleScanUpc(idx, upcScanInput)}
                            disabled={!upcScanInput.trim()}
                            className="px-3 py-2 bg-ninpo-lime text-ninpo-black rounded-lg font-bold text-xs hover:bg-white transition-all disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setScanningForIndex(null);
                              setUpcScanInput('');
                              setKeepScannerOpen(false);
                            }}
                            className="px-3 py-2 bg-white/10 rounded-lg text-xs hover:bg-white/20 transition-all"
                          >
                            Done
                          </button>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={keepScannerOpen}
                            onChange={(e) => setKeepScannerOpen(e.target.checked)}
                            className="rounded"
                          />
                          Keep scanner open for rapid entry
                        </label>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
                        <span className="text-xs text-white/50">
                          {item.upc ? (
                            <span className="text-ninpo-lime">UPC: {item.upc}</span>
                          ) : item.sku ? (
                            <span className="text-white/70">SKU: {item.sku}</span>
                          ) : (
                            <span className="text-yellow-400">⚠ No UPC - will match by name only</span>
                          )}
                        </span>
                        {!item.upc && (
                          <button
                            onClick={() => setScanningForIndex(idx)}
                            className="px-3 py-1 bg-ninpo-lime/20 text-ninpo-lime rounded text-xs font-bold hover:bg-ninpo-lime/30 transition-all flex items-center gap-1"
                          >
                            <Camera className="w-3 h-3" />
                            Scan UPC
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Review Items (needs confirmation) */}
          {reviewItems.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-600/50 rounded-xl p-4 mb-6">
              <h3 className="text-lg font-black text-yellow-400 mb-4 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Review Required ({reviewItems.length})
              </h3>
              <div className="space-y-3">
                {reviewItems.map((review, idx) => (
                  <div key={idx} className="bg-white/5 rounded-lg p-3 border border-yellow-600/30">
                    <p className="text-sm font-bold text-white mb-2">{review.receiptName}</p>
                    {review.suggestedProduct && (
                      <div className="mb-2">
                        <p className="text-xs text-white/70">
                          Suggested: <span className="text-ninpo-lime">{review.suggestedProduct.name}</span>
                        </p>
                        <p className="text-xs text-white/50">
                          Match: {(parseFloat(review.matchScore) * 100).toFixed(0)}% • UPC: {review.suggestedProduct.upc || 'N/A'}
                        </p>
                      </div>
                    )}
                    {review.reason === 'large_price_change' && (
                      <div className="mb-2">
                        <p className="text-xs text-yellow-400">
                          ⚠ Price changed {review.delta}: ${review.oldPrice} → ${review.newPrice}
                        </p>
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={async () => {
                          try {
                            const token = localStorage.getItem('token');
                            await fetch(`${BACKEND_URL}/api/driver/receipt-confirm-match`, {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${token}`
                              },
                              body: JSON.stringify({
                                storeId,
                                productId: review.suggestedProduct?.id || review.product?.id,
                                receiptName: review.receiptName,
                                unitPrice: review.unitPrice,
                                quantity: review.quantity,
                                orderId,
                                receiptPhoto
                              })
                            });
                            // Remove from review list
                            setReviewItems(reviewItems.filter((_, i) => i !== idx));
                            if (reviewItems.length === 1) {
                              setSuccess(true);
                              setTimeout(() => onComplete(), 1500);
                            }
                          } catch (err) {
                            console.error('Confirm failed:', err);
                          }
                        }}
                        className="flex-1 py-2 bg-ninpo-lime text-ninpo-black rounded-lg font-bold text-xs hover:bg-white transition-all flex items-center justify-center gap-1"
                      >
                        <Check className="w-4 h-4" />
                        Confirm Match
                      </button>
                      <button
                        onClick={() => {
                          // Remove from review and allow manual UPC entry
                          setReviewItems(reviewItems.filter((_, i) => i !== idx));
                          setError(`Skipped "${review.receiptName}". Add UPC manually to bind.`);
                        }}
                        className="px-4 py-2 bg-white/10 rounded-lg text-xs hover:bg-white/20 transition-all"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Submit */}
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
              className="flex-1 py-3 bg-ninpo-lime text-ninpo-black hover:bg-white rounded-xl font-black uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>Processing...</>
              ) : (
                <>
                  <DollarSign className="w-5 h-5" />
                  Update Prices
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReceiptCapture;
