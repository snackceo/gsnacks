import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ScannerPanel, { ScannerPanelProps } from './ScannerPanel';
import StoreSelectorModal from './StoreSelectorModal';
import { StoreRecord } from '../types';
import { ScannerMode } from '../types';

interface ReceiptCaptureFlowProps extends Omit<ScannerPanelProps, 'selectedStoreName' | 'selectedStoreLocation'> {
  stores: StoreRecord[];
  defaultStoreId?: string;
  onStoreSelected?: (storeId: string) => void;
  isOpen?: boolean;
}

const ReceiptCaptureFlow: React.FC<ReceiptCaptureFlowProps> = ({
  stores,
  defaultStoreId,
  onStoreSelected,
  isOpen = false,
  mode = ScannerMode.RECEIPT_PARSE_LIVE,
  ...scannerProps
}) => {
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(defaultStoreId || null);
  const [showStoreSelector, setShowStoreSelector] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);

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
          selectedStoreName={selectedStore?.name}
          selectedStoreLocation={
            selectedStore?.address
              ? [
                  selectedStore.address.street,
                  selectedStore.address.city,
                  selectedStore.address.state
                ]
                  .filter(Boolean)
                  .join(', ')
              : undefined
          }
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
