import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Plus, X, ShoppingBag } from 'lucide-react';

interface NotFoundItem {
  sku: string;
  name: string;
  quantity: number;
  price: number;
  originalStore: string;
  attemptedStores: string[];
  foundAt?: string;
}

interface ItemNotFoundTrackerProps {
  orderId: string;
  onItemNotFound: (item: NotFoundItem) => void;
  notFoundItems: NotFoundItem[];
  onRemoveNotFound: (sku: string) => void;
  currentStore: string;
  availableStores: Array<{ id: string; name: string }>;
  onMarkFound?: (sku: string, storeName: string) => void;
}

const ItemNotFoundTracker: React.FC<ItemNotFoundTrackerProps> = ({
  orderId,
  onItemNotFound,
  notFoundItems,
  onRemoveNotFound,
  currentStore,
  availableStores,
  onMarkFound
}) => {
  const [expandedSku, setExpandedSku] = useState<string | null>(null);

  const itemsStillNeeded = notFoundItems.filter(
    item => !item.attemptedStores.includes(currentStore)
  );

  const itemsAlreadyAttempted = notFoundItems.filter(
    item => item.attemptedStores.includes(currentStore)
  );

  const handleMarkAttempted = (sku: string) => {
    const item = notFoundItems.find(i => i.sku === sku);
    if (item && !item.attemptedStores.includes(currentStore)) {
      const updated = {
        ...item,
        attemptedStores: [...item.attemptedStores, currentStore]
      };
      onItemNotFound(updated);
    }
  };

  const storedSuccessfully = notFoundItems.length > 0
    ? itemsAlreadyAttempted.length / notFoundItems.length
    : 0;

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-black text-ninpo-lime mb-1 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Items Not Found
          </h3>
          <p className="text-sm text-white/60">
            Track items across stores. Mark as found or move to next location.
          </p>
        </div>
        {notFoundItems.length > 0 && (
          <div className="bg-ninpo-lime/20 border border-ninpo-lime/40 rounded-lg px-3 py-2">
            <p className="text-xs font-bold text-ninpo-lime uppercase">Total Not Found</p>
            <p className="text-xl font-black text-ninpo-lime">{notFoundItems.length}</p>
          </div>
        )}
      </div>

      {notFoundItems.length === 0 ? (
        <div className="text-center py-8">
          <ShoppingBag className="w-8 h-8 text-white/30 mx-auto mb-2" />
          <p className="text-white/50 text-sm">No items marked as not found yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Items Still Needed at This Store */}
          {itemsStillNeeded.length > 0 && (
            <div className="bg-black/40 border border-yellow-500/30 rounded-lg p-4">
              <p className="text-xs uppercase font-bold text-yellow-400 mb-3">
                To Look For at {currentStore}
              </p>
              <div className="space-y-2">
                {itemsStillNeeded.map((item) => (
                  <div
                    key={item.sku}
                    className="flex items-start justify-between p-3 bg-white/5 rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="font-bold text-sm">{item.name}</p>
                      <p className="text-xs text-white/50">x{item.quantity} @ ${item.price}/ea</p>
                      <p className="text-xs text-white/40 mt-1">
                        Originally from: {item.originalStore}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <button
                        onClick={() => onMarkFound && onMarkFound(item.sku, currentStore)}
                        className="px-3 py-2 bg-ninpo-lime text-ninpo-black hover:bg-white rounded-lg text-xs font-black transition-all whitespace-nowrap"
                        title="Found at this store"
                      >
                        Found here
                      </button>
                      <button
                        onClick={() => handleMarkAttempted(item.sku)}
                        className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold transition-all whitespace-nowrap"
                        title="Not here; try next store"
                      >
                        Not here
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Items Already Attempted */}
          {itemsAlreadyAttempted.length > 0 && (
            <div className="bg-black/40 border border-green-500/30 rounded-lg p-4">
              <p className="text-xs uppercase font-bold text-green-400 mb-3">
                Attempted ({itemsAlreadyAttempted.length})
              </p>
              <div className="space-y-2">
                {itemsAlreadyAttempted.map((item) => (
                  <div
                    key={item.sku}
                    onClick={() => setExpandedSku(expandedSku === item.sku ? null : item.sku)}
                    className="p-3 bg-white/5 rounded-lg border border-green-500/20 cursor-pointer hover:border-green-500/40 transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                          <p className="font-bold text-sm">{item.name}</p>
                        </div>
                        <p className="text-xs text-white/50 ml-6">x{item.quantity} @ ${item.price}/ea</p>
                        {item.foundAt && (
                          <p className="text-xs text-ninpo-lime ml-6 mt-1">Found at: {item.foundAt}</p>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveNotFound(item.sku);
                        }}
                        className="ml-2 p-2 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {expandedSku === item.sku && (
                      <div className="mt-3 pt-3 border-t border-white/10 text-xs">
                        <p className="text-white/60 font-bold mb-2">Attempted at:</p>
                        <div className="flex flex-wrap gap-1">
                          {item.attemptedStores.map((store) => (
                            <span
                              key={store}
                              className="px-2 py-1 bg-green-500/10 text-green-300 rounded text-xs font-bold"
                            >
                              {store}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            <div className="bg-black/40 border border-white/10 rounded-lg p-3 text-center">
              <p className="text-xs text-white/60 uppercase font-bold">Still Searching</p>
              <p className="text-2xl font-black text-ninpo-lime">{itemsStillNeeded.length}</p>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-lg p-3 text-center">
              <p className="text-xs text-white/60 uppercase font-bold">Attempted</p>
              <p className="text-2xl font-black text-white">{itemsAlreadyAttempted.length}</p>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-lg p-3 text-center">
              <p className="text-xs text-white/60 uppercase font-bold">Success Rate</p>
              <p className="text-2xl font-black text-green-400">
                {Math.round(storedSuccessfully * 100)}%
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ItemNotFoundTracker;
