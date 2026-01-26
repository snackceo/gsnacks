import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ScannerPanel, { ScannerPanelProps } from './ScannerPanel';
import StoreSelectorModal from './StoreSelectorModal';
import { StoreRecord } from '../types';
import { ScannerMode } from '../types';
import { formatStoreAddress } from '../utils/address';

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
  stores = [],
  defaultStoreId,
  onStoreSelected,
  onPrimarySupplierToggle,
  isOpen = false,
  mode = ScannerMode.RECEIPT_PARSE_LIVE,
  ...scannerProps
}) => {
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(defaultStoreId || null);
  const [pendingStoreId, setPendingStoreId] = useState<string | null>(defaultStoreId || null);
  const [showStoreSelector, setShowStoreSelector] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [sessionPrimarySupplier, setSessionPrimarySupplier] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (defaultStoreId) {
      setSelectedStoreId(defaultStoreId);
      setPendingStoreId(defaultStoreId);
    } else {
      setSelectedStoreId(null);
      setPendingStoreId(null);
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

  // When isOpen changes, show store selector first
  useEffect(() => {
    if (isOpen) {
      setShowStoreSelector(true);
      setIsCameraOpen(false);
      setPendingStoreId(prev => prev ?? selectedStoreId);
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

  const pendingStore = useMemo(
    () => stores.find(s => s.id === pendingStoreId) || null,
    [stores, pendingStoreId]
  );

  const pendingStoreIsPrimary = useMemo(() => {
    if (!pendingStoreId) return undefined;
    const override = sessionPrimarySupplier[pendingStoreId];
    if (typeof override === 'boolean') return override;
    return pendingStore?.isPrimarySupplier ?? false;
  }, [pendingStoreId, sessionPrimarySupplier, pendingStore]);

  const handleStoreChange = useCallback((storeId: string) => {
    setPendingStoreId(storeId);
  }, []);

  const handleStoreConfirm = useCallback(() => {
    if (!pendingStoreId) return;
    setSelectedStoreId(pendingStoreId);
    setShowStoreSelector(false);
    setIsCameraOpen(true); // Open camera after store confirmation
    onStoreSelected?.(pendingStoreId);
  }, [onStoreSelected, pendingStoreId]);

  const handleStorelessConfirm = useCallback(() => {
    setSelectedStoreId(null);
    setPendingStoreId(null);
    setShowStoreSelector(false);
    setIsCameraOpen(true);
    // Proceeding without store - AI matching will be less accurate but still possible
  }, []);

  const handleStoreModalCancel = useCallback(() => {
    setShowStoreSelector(false);
    setIsCameraOpen(false);
    setPendingStoreId(selectedStoreId);
    scannerProps.onClose?.();
  }, [scannerProps, selectedStoreId]);

  const handlePrimarySupplierToggle = useCallback(
    (storeId: string, nextValue: boolean) => {
      setSessionPrimarySupplier(prev => ({ ...prev, [storeId]: nextValue }));
      onPrimarySupplierToggle?.(storeId, nextValue);
    },
    [onPrimarySupplierToggle]
  );

  const handlePrimarySupplierToggleForScanner = useCallback(() => {
    if (!selectedStoreId) return;
    const nextValue = !(selectedStoreIsPrimary ?? false);
    handlePrimarySupplierToggle(selectedStoreId, nextValue);
  }, [handlePrimarySupplierToggle, selectedStoreId, selectedStoreIsPrimary]);

  // Render camera when the flow is open (store selection optional)
  const shouldRenderCamera = isCameraOpen;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Store selector modal */}
      {isOpen && (
        <StoreSelectorModal
          stores={stores}
          activeStoreId={pendingStoreId || ''}
          isOpen={showStoreSelector}
          onStoreChange={handleStoreChange}
          onConfirm={handleStoreConfirm}
          onConfirmWithoutStore={handleStorelessConfirm}
          onCancel={handleStoreModalCancel}
          selectedStoreIsPrimary={pendingStoreIsPrimary}
          onPrimarySupplierToggle={handlePrimarySupplierToggle}
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
            selectedStore ? formatStoreAddress(selectedStore.address, undefined) || undefined : undefined
          }
          selectedStoreIsPrimary={selectedStoreIsPrimary}
          onTogglePrimarySupplier={selectedStore ? handlePrimarySupplierToggleForScanner : undefined}
          onClose={() => {
            setIsCameraOpen(false);
            scannerProps.onClose?.();
          }}
        />
      )}
    </div>
  );
};

export default ReceiptCaptureFlow;
