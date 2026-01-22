import React, { useMemo } from 'react';
import { Check, AlertCircle, XCircle } from 'lucide-react';
import { ClassifiedReceiptItem, ReceiptItemClassification } from '../types';
import { getBucketInfo } from '../utils/classificationUtils';

interface ReceiptItemBucketProps {
  items: ClassifiedReceiptItem[];
  selectedItems?: Map<string, boolean>;
  onItemToggle?: (item: ClassifiedReceiptItem, classification: ReceiptItemClassification, checked: boolean) => void;
  isReadOnly?: boolean;
}

const getBucketIcon = (classification: ReceiptItemClassification) => {
  const icons: Record<ReceiptItemClassification, React.ReactNode> = {
    A: <Check className="w-5 h-5 text-green-400" />,
    B: <AlertCircle className="w-5 h-5 text-yellow-400" />,
    C: <XCircle className="w-5 h-5 text-red-400" />
  };
  return icons[classification];
};

const ReceiptItemBucket: React.FC<ReceiptItemBucketProps> = ({
  items = [],
  selectedItems = new Map(),
  onItemToggle,
  isReadOnly = false
}) => {
  const buckets = useMemo(() => {
    const grouped: Record<ReceiptItemClassification, ClassifiedReceiptItem[]> = {
      A: [],
      B: [],
      C: []
    };

    items.forEach(item => {
      grouped[item.classification].push(item);
    });

    return grouped;
  }, [items]);

  const bucketOrder: ReceiptItemClassification[] = ['A', 'B', 'C'];

  return (
    <div className="space-y-6">
      {bucketOrder.map(bucket => {
        const bucketItems = buckets[bucket];
        const info = getBucketInfo(bucket);

        return (
          <div key={bucket} className="space-y-2">
            {/* Bucket header */}
            <div className={`p-3 rounded-xl border ${info.color} space-y-1`}>
              <div className="flex items-center gap-2">
                {getBucketIcon(bucket)}
                <h3 className="font-bold text-white text-sm">{info.label}</h3>
                <span className="ml-auto text-xs font-semibold text-slate-300">
                  {bucketItems.length} item{bucketItems.length !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-xs text-slate-400">{info.description}</p>
            </div>

            {/* Bucket items */}
            {bucketItems.length > 0 ? (
              <div className="space-y-2 pl-3 border-l-2 border-white/10">
                {bucketItems.map((item, idx) => {
                  const itemKey = JSON.stringify(item);
                  const isSelected = selectedItems.get(itemKey) ?? (bucket === 'A' && !isReadOnly);

                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        if (!isReadOnly && onItemToggle) {
                          onItemToggle(item, bucket, !isSelected);
                        }
                      }}
                      className={`p-3 rounded-lg border transition ${
                        !isReadOnly ? 'cursor-pointer' : 'cursor-default'
                      } ${
                        isSelected
                          ? 'bg-white/10 border-white/30'
                          : 'bg-white/5 border-white/10 hover:bg-white/8'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">
                            {item.receiptName}
                          </p>
                          <div className="flex gap-3 mt-1 text-xs text-slate-400">
                            <span>Qty: {item.quantity}</span>
                            <span>Total: ${item.totalPrice.toFixed(2)}</span>
                            <span>Unit: ${item.unitPrice.toFixed(2)}</span>
                          </div>
                          {item.matchConfidence !== undefined && (
                            <p className="text-xs text-slate-500 mt-1">
                              Confidence: {(item.matchConfidence * 100).toFixed(0)}%
                            </p>
                          )}
                          {item.suggestedProduct && (
                            <div className="text-xs text-ninpo-lime mt-1">
                              ✓ {item.suggestedProduct.name}
                            </div>
                          )}
                        </div>
                        {!isReadOnly && (
                          <div className="flex-shrink-0 w-5 h-5 rounded border border-white/20 mt-0.5">
                            {isSelected && (
                              <div className="w-full h-full bg-ninpo-lime flex items-center justify-center rounded-sm">
                                <Check className="w-3 h-3 text-ninpo-black" />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 pl-3 italic">No items in this category</p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ReceiptItemBucket;
