import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, X, Check, Loader2 } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

interface Store {
  _id: string;
  name: string;
}

interface ReceiptPhotoCaptureProps {
  storeId: string;
  storeName: string;
  orderId?: string;
  onComplete: (captureId: string) => void;
  onCancel: () => void;
}

interface CapturedImage {
  file: File;
  preview: string;
  uploaded?: boolean;
  url?: string;
  thumbnailUrl?: string;
}

export default function ReceiptPhotoCapture({ storeId: initialStoreId, storeName: initialStoreName, orderId, onComplete, onCancel }: ReceiptPhotoCaptureProps) {
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>(initialStoreId || '');
  const [customStoreName, setCustomStoreName] = useState<string>(initialStoreName || '');
  const [loadingStores, setLoadingStores] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Fetch available stores
  useEffect(() => {
    const fetchStores = async () => {
      try {
        const resp = await fetch(`${BACKEND_URL}/api/stores`, {
          credentials: 'include'
        });
        if (resp.ok) {
          const data = await resp.json();
          setStores(data.stores || []);
        }
      } catch (err) {
        console.error('Error fetching stores:', err);
      } finally {
        setLoadingStores(false);
      }
    };

    fetchStores();
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    
    if (images.length + files.length > 3) {
      setError('Maximum 3 photos allowed');
      return;
    }

    const newImages: CapturedImage[] = files.map((file: File) => ({
      file,
      preview: URL.createObjectURL(file)
    }));

    setImages(prev => [...prev, ...newImages]);
    setError('');
  };

  const removeImage = (index: number) => {
    setImages(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  };

  const uploadToCloudinary = async (file: File): Promise<{ url: string; thumbnailUrl: string }> => {
    // Convert file to base64
    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const base64Data = await base64Promise;
    
    const response = await fetch(`${BACKEND_URL}/api/driver/upload-receipt-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ image: base64Data })
    });

    if (!response.ok) {
      let errorMsg = 'Failed to upload image';
      try {
        const errorData = await response.json();
        errorMsg = errorData.error || errorMsg;
      } catch {
        errorMsg = `Upload failed: ${response.status} ${response.statusText}`;
      }
      throw new Error(errorMsg);
    }

    const data = await response.json();
    if (!data.url) {
      throw new Error('Server returned invalid response (missing url)');
    }
    return {
      url: data.url,
      thumbnailUrl: data.thumbnailUrl || data.url
    };
  };

  const handleSubmit = async () => {
    if (images.length === 0) {
      setError('At least one photo required');
      return;
    }

    if (!selectedStoreId) {
      setError('Please select a store');
      return;
    }

    const storeNameToUse = customStoreName || stores.find(s => s._id === selectedStoreId)?.name || 'Unknown Store';

    setUploading(true);
    setError('');

    try {
      // Upload all images
      const uploadedImages = await Promise.all(
        images.map(async (img, idx) => {
          if (img.uploaded) {
            return { url: img.url!, thumbnailUrl: img.thumbnailUrl! };
          }
          
          const result = await uploadToCloudinary(img.file);
          
          // Update local state to show progress
          setImages(prev => {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], uploaded: true, ...result };
            return updated;
          });
          
          return result;
        })
      );

      // Create receipt capture (with idempotency UUID)
      const captureRequestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const captureResponse = await fetch(`${BACKEND_URL}/api/driver/receipt-capture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          captureRequestId, // For idempotency - browser retries will return same capture
          storeId: selectedStoreId,
          storeName: storeNameToUse,
          orderId,
          images: uploadedImages
        })
      });

      if (!captureResponse.ok) {
        let errorMsg = 'Failed to create receipt capture';
        try {
          const errorData = await captureResponse.json();
          errorMsg = errorData.error || errorMsg;
        } catch {
          errorMsg = `Capture failed: ${captureResponse.status} ${captureResponse.statusText}`;
        }
        throw new Error(errorMsg);
      }

      const captureData = await captureResponse.json();
      const captureId = captureData.captureId;
      if (!captureId) {
        throw new Error('Server did not return captureId');
      }

      // Trigger parsing
      setParsing(true);
      const parseResponse = await fetch(`${BACKEND_URL}/api/driver/receipt-parse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ captureId })
      });

      if (!parseResponse.ok) {
        let errorMsg = 'Failed to parse receipt';
        try {
          const errorData = await parseResponse.json();
          errorMsg = errorData.error || errorMsg;
        } catch {
          errorMsg = `Parse failed: ${parseResponse.status} ${parseResponse.statusText}`;
        }
        throw new Error(errorMsg);
      }

      // Success!
      onComplete(captureId);

    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || 'Failed to upload receipt');
    } finally {
      setUploading(false);
      setParsing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Camera className="w-6 h-6" />
                Receipt Photo Capture
              </h2>
              <p className="text-sm text-green-100 mt-1">
                {loadingStores ? 'Loading stores...' : (customStoreName || stores.find(s => s._id === selectedStoreId)?.name || 'Select a store')}
              </p>
            </div>
            <button onClick={onCancel} className="text-white hover:bg-white/20 rounded p-2">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 m-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Store Selector */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-amber-900 mb-3">Select Store Location:</h3>
            {loadingStores ? (
              <p className="text-amber-800 text-sm">Loading stores...</p>
            ) : (
              <div className="space-y-3">
                <select
                  value={selectedStoreId}
                  onChange={(e) => {
                    setSelectedStoreId(e.target.value);
                    setCustomStoreName('');
                  }}
                  className="w-full border border-amber-300 rounded-lg px-4 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">-- Select from existing stores --</option>
                  {stores.map(store => (
                    <option key={store._id} value={store._id}>
                      {store.name}
                    </option>
                  ))}
                </select>
                
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-amber-300"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-amber-50 text-amber-600 font-semibold">OR</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-amber-900 mb-2">Create new store:</label>
                  <input
                    type="text"
                    value={customStoreName}
                    onChange={(e) => {
                      setCustomStoreName(e.target.value);
                      setSelectedStoreId(''); // Clear selection when typing custom name
                    }}
                    placeholder="e.g., Walmart 1, Kroger B, Target Downtown"
                    className="w-full border border-amber-300 rounded-lg px-4 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-blue-900 mb-2">Instructions:</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Take 1-3 clear photos of the receipt</li>
              <li>• Ensure all items and prices are visible</li>
              <li>• For long receipts, take multiple photos</li>
              <li>• Good lighting helps with accuracy</li>
            </ul>
          </div>

          {/* Image preview grid */}
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-4 mb-6">
              {images.map((img, idx) => (
                <div key={idx} className="relative group">
                  <img
                    src={img.preview}
                    alt={`Receipt ${idx + 1}`}
                    className="w-full h-48 object-cover rounded-lg border-2 border-gray-300"
                  />
                  {img.uploaded && (
                    <div className="absolute top-2 right-2 bg-green-500 text-white rounded-full p-1">
                      <Check className="w-4 h-4" />
                    </div>
                  )}
                  <button
                    onClick={() => removeImage(idx)}
                    className="absolute top-2 left-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          {images.length < 3 && (
            <div className="space-y-3">
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileSelect}
                className="hidden"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-4 rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 flex items-center justify-center gap-2"
              >
                <Camera className="w-5 h-5" />
                Take Photo
              </button>
              
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 flex items-center justify-center gap-2"
              >
                <Upload className="w-5 h-5" />
                Upload from Gallery
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 bg-gray-50 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {images.length} of 3 photos
            {images.length > 0 && ` • ${images.filter(i => i.uploaded).length} uploaded`}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={uploading || parsing}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={images.length === 0 || uploading || parsing}
              className="px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded font-semibold hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 flex items-center gap-2"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Uploading...
                </>
              ) : parsing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Parsing...
                </>
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  Upload & Parse
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
