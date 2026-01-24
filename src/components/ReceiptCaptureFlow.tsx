import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ScannerPanel, { ScannerPanelProps } from './ScannerPanel';
import StoreSelectorModal from './StoreSelectorModal';
import { StoreRecord } from '../types';
import { ScannerMode } from '../types';

interface ReceiptCaptureFlowProps
  extends Omit<
    ScannerPanelProps,
    | 'selectedStoreId'
    | 'selectedStoreName'
    | 'selectedStoreBrand'
    | 'selectedStoreLocation'
    | 'selectedStoreIsPrimary'
    | 'onTogglePrimarySupplier'
  > {
  stores: StoreRecord[];
  defaultStoreId?: string;
  onStoreSelected?: (storeId: string) => void;
  onPrimarySupplierToggle?: (storeId: string, nextValue: boolean) => void;
  isOpen?: boolean;
}

const PRIMARY_SUPPLIER_SESSION_KEY = 'receipt.primarySupplierOverrides';

const formatStoreBrand = (storeType?: string) => {
  if (!storeType) return 'Other';
  return storeType.charAt(0).toUpperCase() + storeType.slice(1);
};

const ReceiptCaptureFlow: React.FC<ReceiptCaptureFlowProps> = ({
  stores,
  defaultStoreId,
  onStoreSelected,
  onPrimarySupplierToggle,
  isOpen = false,
  mode = ScannerMode.RECEIPT_PARSE_LIVE,
  ...scannerProps
}) => {
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(defaultStoreId || null);
  const [showStoreSelector, setShowStoreSelector] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [sessionPrimarySupplier, setSessionPrimarySupplier] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (defaultStoreId) {
      setSelectedStoreId(defaultStoreId);
    }
  }, [defaultStoreId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem(PRIMARY_SUPPLIER_SESSION_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Record<string, boolean>;
      setSessionPrimarySupplier(parsed || {});
    } catch {
      setSessionPrimarySupplier({});
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(PRIMARY_SUPPLIER_SESSION_KEY, JSON.stringify(sessionPrimarySupplier));
  }, [sessionPrimarySupplier]);

  // When isOpen changes, handle showing store selector or camera
  useEffect(() => {
    if (isOpen) {
      if (selectedStoreId) {
        // Store already selected, open camera
        setIsCameraOpen(true);
      } else {
        // No store selected, show selector first
        setShowStoreSelector(true);
      }
    } else {
      // Closing the flow
      setIsCameraOpen(false);
      setShowStoreSelector(false);
    }
  }, [isOpen, selectedStoreId]);

  const selectedStore = useMemo(
    () => stores.find(s => s.id === selectedStoreId) || null,
    [stores, selectedStoreId]
  );

  const selectedStoreIsPrimary = useMemo(() => {
    if (!selectedStoreId) return undefined;
    const override = sessionPrimarySupplier[selectedStoreId];
    if (typeof override === 'boolean') return override;
    return selectedStore?.isPrimarySupplier ?? false;
  }, [selectedStoreId, sessionPrimarySupplier, selectedStore]);

  const handleStoreSelect = useCallback(
    (storeId: string) => {
      setSelectedStoreId(storeId);
      setShowStoreSelector(false);
      setIsCameraOpen(true); // Open camera after store selection
      onStoreSelected?.(storeId);
    },
    [onStoreSelected]
  );

  const handleStoreModalCancel = useCallback(() => {
    setShowStoreSelector(false);
    setIsCameraOpen(false);
    scannerProps.onClose?.();
  }, [scannerProps]);

  const handlePrimarySupplierToggle = useCallback(() => {
    if (!selectedStoreId) return;
    const nextValue = !(selectedStoreIsPrimary ?? false);
    setSessionPrimarySupplier(prev => ({ ...prev, [selectedStoreId]: nextValue }));
    onPrimarySupplierToggle?.(selectedStoreId, nextValue);
  }, [onPrimarySupplierToggle, selectedStoreId, selectedStoreIsPrimary]);

  // Only render camera if store is selected and should be open
  const shouldRenderCamera = selectedStoreId && isCameraOpen;

  return (
    <>
      {/* Store selector modal */}
      {isOpen && (
        <StoreSelectorModal
          stores={stores}
          activeStoreId={selectedStoreId || ''}
          isOpen={showStoreSelector}
          onSelect={handleStoreSelect}
          onCancel={handleStoreModalCancel}
        />
      )}

      {/* Camera scanner */}
      {shouldRenderCamera && (
        <ScannerPanel
          {...scannerProps}
          mode={mode}
          selectedStoreId={selectedStore?.id}
          selectedStoreName={selectedStore?.name}
          selectedStoreBrand={selectedStore ? formatStoreBrand(selectedStore.storeType) : undefined}
          selectedStoreLocation={
            selectedStore?.address
              ? [
                  selectedStore.address.street,
                  selectedStore.address.city,
                  selectedStore.address.state,
                  selectedStore.address.zip
                ]
                  .filter(Boolean)
                  .join(', ')
              : undefined
          }
          selectedStoreIsPrimary={selectedStoreIsPrimary}
          onTogglePrimarySupplier={selectedStore ? handlePrimarySupplierToggle : undefined}
          receiptSaveDisabled={!selectedStoreId}
          receiptSaveDisabledReason="Select a store before capturing receipts."
          onClose={() => {
            setIsCameraOpen(false);
            scannerProps.onClose?.();
          }}
        />
      )}
    </>
  );
};

export default ReceiptCaptureFlow;
