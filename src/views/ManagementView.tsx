import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Type-only imports for TSX type references
import type {
  UserStatsSummary,
  AuditLog,
  LedgerEntry,
  AuditLogType,
  User,
  Product,
  Order,
  AppSettings,
  ApprovalRequest,
  ReturnVerification,
  SizeUnit
} from '../types';
import { ScannerMode, OrderStatus } from '../types';
import ManagementDashboard from './management/ManagementDashboard';
import ManagementOrders from './management/ManagementOrders';
import ManagementUsers from './management/ManagementUsers';
import ManagementAuditLogs from './management/ManagementAuditLogs';
import ManagementInventory from './management/ManagementInventory';
import ManagementUpcRegistry from './management/ManagementUpcRegistry';
import ManagementSettings from './management/ManagementSettings';
import ManagementApprovals from './management/ManagementApprovals';
import {
  Truck,
  Package,
  Users,
  BarChart3,
  ShieldCheck,
  Loader2,
  Terminal,
  Sliders,
  EyeOff,
  Plus,
  ScanLine,
  X
} from 'lucide-react';
import ScannerModal from '../components/ScannerModal';
import UnmappedUpcModal from '../components/UnmappedUpcModal';
import { UnmappedUpcData } from '../types';
import {
  getAdvancedInventoryInsights,
  getAvailableAuditModels,
  getOperationsSummary,
  getAuditLogSummary
} from '../services/geminiService';
import { useNinpoCore } from '../hooks/useNinpoCore';
import { BACKEND_URL } from '../constants';
import { SETTINGS_STORAGE_KEY, SIZE_UNIT_OPTIONS, UPC_CONTAINER_LABELS } from './management/constants';
import {
  countTotalUpcs,
  fmtDelta,
  fmtTime,
  formatSize,
  getTierStyles,
  isNewSignupWithBonus
} from './management/utils';
import { useInventoryCreate } from './management/hooks/useInventoryCreate';
import { useUpcRegistry } from './management/hooks/useUpcRegistry';
import InventoryCreateForm from './management/InventoryCreateForm';

interface ManagementViewProps {
  user: User;
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  orders: Order[];
  users: User[];
  userStats: Record<string, UserStatsSummary>;
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  approvals: ApprovalRequest[];
  auditLogs: AuditLog[];
  updateOrder: (id: string, status: OrderStatus, metadata?: any) => void;
  adjustCredits: (userId: string, amount: number, reason: string) => void;
  updateUserProfile: (id: string, updates: Partial<User>) => void;
  fetchUsers: () => Promise<User[]>;
  fetchUserStats: (userId: string) => Promise<UserStatsSummary | null>;
  fetchApprovals: () => Promise<ApprovalRequest[]>;
  fetchAuditLogs: () => Promise<AuditLog[]>;
  fetchReturnVerifications: () => Promise<ReturnVerification[]>;
  settleReturnVerification: (verificationId: string, finalAcceptedCount: number, creditAmount: number, cashAmount: number) => Promise<void>;
}

const ManagementView: React.FC<ManagementViewProps> = ({
  user,
  products,
  setProducts,
  orders,
  users,
  userStats,
  settings,
  setSettings,
  approvals,
  auditLogs,
  updateOrder,
  adjustCredits,
  updateUserProfile,
  fetchUsers,
  fetchUserStats,
  fetchApprovals,
  fetchAuditLogs,
  fetchReturnVerifications,
  settleReturnVerification
}) => {
  const { addToast } = useNinpoCore();
  const [activeModule, setActiveModule] = useState<string>('analytics');
  const [isAuditing, setIsAuditing] = useState(false);
  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);
  const [isChartVisible, setIsChartVisible] = useState(false);
  const [userFilter, setUserFilter] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [userDrafts, setUserDrafts] = useState<Record<string, Partial<User>>>({});
  const [userLedgers, setUserLedgers] = useState<Record<string, LedgerEntry[]>>({});
  const [ledgerLoading, setLedgerLoading] = useState<Record<string, boolean>>({});
  const [ledgerErrors, setLedgerErrors] = useState<Record<string, string | null>>({});
  const [userStatsLoading, setUserStatsLoading] = useState<Record<string, boolean>>({});
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(settings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [isAuditLogsLoading, setIsAuditLogsLoading] = useState(false);
  const [auditLogsError, setAuditLogsError] = useState<string | null>(null);
  const [auditSummary, setAuditSummary] = useState<string | null>(null);
  const [isAuditSummaryLoading, setIsAuditSummaryLoading] = useState(false);
  const [auditModel, setAuditModel] = useState('');
  const [auditModels, setAuditModels] = useState<string[]>([]);
  const [isAuditModelsLoading, setIsAuditModelsLoading] = useState(false);
  const [auditModelsError, setAuditModelsError] = useState<string | null>(null);
  const [opsSummary, setOpsSummary] = useState('');
  const [isOpsSummaryLoading, setIsOpsSummaryLoading] = useState(false);
  const [scannerModalOpen, setScannerModalOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<ScannerMode>(ScannerMode.INVENTORY_CREATE);
  const [lastBlockedUpc, setLastBlockedUpc] = useState<string | null>(null);
  const [lastBlockedReason, setLastBlockedReason] = useState<'cooldown' | 'duplicate' | null>(null);
  const [unmappedUpcModalOpen, setUnmappedUpcModalOpen] = useState(false);
  const [unmappedUpcPayload, setUnmappedUpcPayload] = useState<UnmappedUpcData | null>(null);

  // Return verifications state
  const [returnVerifications, setReturnVerifications] = useState<ReturnVerification[]>([]);
  const [isReturnVerificationsLoading, setIsReturnVerificationsLoading] = useState(false);
  const [returnVerificationsError, setReturnVerificationsError] = useState<string | null>(null);
  const [settlingVerificationId, setSettlingVerificationId] = useState<string | null>(null);

  const upcRegistry = useUpcRegistry({ activeModule });

  const {
    upcItems,
    setUpcItems,
    upcItemsRef,
    upcInput,
    setUpcInput,
    upcFilter,
    setUpcFilter,
    upcDraft,
    setUpcDraft,
    isUpcLoading,
    isUpcSaving,
    upcError,
    apiLoadUpcItems,
    handleUpcLookup,
    apiSaveUpc,
    apiDeleteUpc,
    apiDeleteUpcDirect,
    apiLinkUpc,
    loadUpcDraft,
    filteredUpcItems,
    handleUpcScannerScan
  } = upcRegistry;

  const inventoryCreate = useInventoryCreate({
    activeModule,
    scannerMode,
    setScannerMode,
    setScannerModalOpen,
    setProducts,
    setUpcInput,
    upcDraft,
    setUpcDraft,
    upcItemsRef,
    products
  });

  const {
    isCreating,
    setIsCreating,
    createError,
    setCreateError,
    newProduct,
    setNewProduct,
    scannedUpcForCreation,
    setScannedUpcForCreation,
    offLookupStatus,
    offLookupMessage,
    setOffLookupMessage,
    offLookupIngredients,
    offLookupNutriments,
    offNutritionEntries,
    fetchOffLookup,
    handleManualUpcChange,
    handleScannerScan: handleInventoryScannerScan,
    handleCancelCreate,
    apiCreateProduct,
    handleAddToUpcRegistry,
    draftStatus,
    setDraftStatus,
    isDirty,
    setIsDirty,
    pendingUpc,
    setPendingUpc,
    batchMode,
    toggleBatchMode,
    batchQueue,
    setBatchQueue,
    addBatchQueueToRegistry
  } = inventoryCreate;

  const handleModuleSelect = (moduleId: string) => {
    setActiveModule(moduleId);
  };

  useEffect(() => {
    if (!settingsDirty) {
      setSettingsDraft(settings);
    }
  }, [settings, settingsDirty]);

  useEffect(() => {
    let isMounted = true;
    const loadModels = async () => {
      setIsAuditModelsLoading(true);
      setAuditModelsError(null);
      const data = await getAvailableAuditModels();
      if (!isMounted) return;
      const models = data.models || [];
      setAuditModels(models);
      if (models.length) {
        const preferred = data.defaultModel && models.includes(data.defaultModel)
          ? data.defaultModel
          : models[0];
        setAuditModel(current => (current && models.includes(current) ? current : preferred));
      } else {
        setAuditModelsError('No AI models available.');
      }
      setIsAuditModelsLoading(false);
    };

    loadModels();
    return () => {
      isMounted = false;
    };
  }, []);

  // Inventory create form
  const [inventorySort, setInventorySort] = useState<
    'alpha' | 'price' | 'brand' | 'type' | 'storage-zone' | 'storage-bin'
  >('alpha');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: '',
    price: 0,
    deposit: 0,
    stock: 0,
    sizeOz: 0,
    sizeUnit: 'oz' as SizeUnit,
    category: '',
    brand: '',
    productType: '',
    nutritionNote: '',
    storageZone: '',
    storageBin: '',
    image: '',
    isGlass: false
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [approvalFilter, setApprovalFilter] =
    useState<ApprovalRequest['status']>('PENDING');
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  const chartData = useMemo(() => {
    return (orders || [])
      .filter((o: any) => o)
      .slice(0, 15)
      .map((o: any) => {
        const idCandidate = o?.id ?? o?._id ?? o?.orderId;
        const id = typeof idCandidate === 'string' ? idCandidate : String(idCandidate || '');
        const label =
          id.trim() ||
          (o?.createdAt
            ? new Date(o.createdAt).toLocaleDateString()
            : 'UNKNOWN');
        const revenueValue =
          o?.total ??
          o?.totalAmount ??
          o?.amount ??
          o?.totalCents ??
          o?.totalAmountCents ??
          0;
        const revenueNumber = Number(revenueValue);
        const hasCents = o?.totalCents != null || o?.totalAmountCents != null;
        const revenue = Number.isFinite(revenueNumber)
          ? hasCents
            ? revenueNumber / 100
            : revenueNumber
          : 0;
        return {
          name: label.slice(-10),
          revenue
        };
      })
      .reverse();
  }, [orders]);

  const filteredApprovals = useMemo(() => {
    return approvals.filter(approval => approval.status === approvalFilter);
  }, [approvals, approvalFilter]);

  const sortedProducts = useMemo(() => {
    const list = [...products];
    const safeText = (value?: string) => (value || '').toLowerCase();
    list.sort((a, b) => {
      switch (inventorySort) {
        case 'price':
          return Number(a.price || 0) - Number(b.price || 0);
        case 'brand':
          return safeText(a.brand).localeCompare(safeText(b.brand));
        case 'type':
          return safeText(a.productType).localeCompare(safeText(b.productType));
        case 'storage-zone':
          return safeText(a.storageZone).localeCompare(safeText(b.storageZone));
        case 'storage-bin':
          return safeText(a.storageBin).localeCompare(safeText(b.storageBin));
        case 'alpha':
        default:
          return safeText(a.name).localeCompare(safeText(b.name));
      }
    });
    return list;
  }, [products, inventorySort]);

  const [auditTypeFilter, setAuditTypeFilter] = useState<'ALL' | AuditLogType>('ALL');
  const [auditActorFilter, setAuditActorFilter] = useState('');
  const [auditRangeFilter, setAuditRangeFilter] = useState<'24h' | '7d' | '30d'>('7d');
  const allowPlatinumTier = Boolean(settings.allowPlatinumTier);

  const auditTypeOptions = useMemo(() => {
    const types = Array.from(new Set(auditLogs.map(log => log.type))).sort();
    return ['ALL', ...types] as const;
  }, [auditLogs]);

  const filteredAuditLogs = useMemo(() => {
    const rangeMsMap = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    const cutoff = Date.now() - rangeMsMap[auditRangeFilter];
    const actorNeedle = auditActorFilter.trim().toLowerCase();

    return auditLogs
      .filter(log => {
        if (auditTypeFilter !== 'ALL' && log.type !== auditTypeFilter) return false;
        if (actorNeedle && !log.actorId.toLowerCase().includes(actorNeedle)) return false;
        if (log.createdAt) {
          const createdAt = new Date(log.createdAt).getTime();
          if (!Number.isNaN(createdAt) && createdAt < cutoff) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return bTime - aTime;
      });
  }, [auditLogs, auditActorFilter, auditRangeFilter, auditTypeFilter]);

  useEffect(() => {
    if (activeModule !== 'analytics') {
      setIsChartReady(false);
      return;
    }

    let firstFrame = 0;
    let secondFrame = 0;

    firstFrame = window.requestAnimationFrame(() => {
      firstFrame = 0;
      secondFrame = window.requestAnimationFrame(() => {
        setIsChartReady(true);
      });
    });

    return () => {
      if (firstFrame) {
        window.cancelAnimationFrame(firstFrame);
      }
      if (secondFrame) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [activeModule]);

  useEffect(() => {
    if (activeModule !== 'logs') return;

    let isActive = true;
    const loadAuditLogs = async () => {
      setIsAuditLogsLoading(true);
      setAuditLogsError(null);

      try {
        await fetchAuditLogs();
      } catch (e: any) {
        if (isActive) {
          setAuditLogsError(e?.message || 'Failed to load audit logs');
        }
      } finally {
        if (isActive) {
          setIsAuditLogsLoading(false);
        }
      }
    };

    loadAuditLogs();
    return () => {
      isActive = false;
    };
  }, [activeModule, fetchAuditLogs]);

  useEffect(() => {
    if (activeModule !== 'reviews') return;
    fetchApprovals().catch(() => {});
  }, [activeModule, fetchApprovals]);

  useEffect(() => {
    if (activeModule !== 'analytics') {
      setIsChartVisible(false);
      return;
    }

    const container = chartContainerRef.current;
    if (!container) {
      setIsChartVisible(false);
      return;
    }

    let frameId = 0;
    const updateVisibility = () => {
      const hasSize = container.offsetHeight > 0 && container.offsetWidth > 0;
      setIsChartVisible(hasSize);
    };

    updateVisibility();
    frameId = window.requestAnimationFrame(updateVisibility);

    const observer = new ResizeObserver(updateVisibility);
    observer.observe(container);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      observer.disconnect();
    };
  }, [activeModule]);

  useEffect(() => {
    if (!settingsDirty) {
      setSettingsDraft(settings);
    }
  }, [settings, settingsDirty]);

  const handleApprove = async (approval: ApprovalRequest) => {
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/approvals/${approval.id}/approve`,
        {
          method: 'POST',
          credentials: 'include'
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Approval failed');

      adjustCredits(approval.userId, approval.amount, `AUTH_APPROVED: ${approval.type}`);

      if (approval.type === 'REFUND' && approval.orderId) {
        updateOrder(approval.orderId, OrderStatus.REFUNDED);
      }

      await fetchApprovals();
    } catch {
      // keep existing state on failure
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/approvals/${id}/reject`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Reject failed');

      await fetchApprovals();
    } catch {
      // keep existing state on failure
    }
  };

  const handleLogisticsUpdate = (orderId: string, status: OrderStatus, metadata?: any) => {
    if (!orderId) return;
    updateOrder(orderId, status, metadata);
  };

  const updateSettingsDraft = (updates: Partial<AppSettings>) => {
    setSettingsDraft(prev => ({ ...prev, ...updates }));
    setSettingsDirty(true);
    setSettingsSaved(false);
  };

  const saveSettings = async () => {
    setIsSavingSettings(true);
    setSettingsError(null);
    setSettingsSaved(false);

    const parseNullableNumber = (value: number | null) => {
      if (value === null) return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };

    const nextSettings: AppSettings = {
      ...settingsDraft,
      routeFee: Number(settingsDraft.routeFee || 0),
      referralBonus: Number(settingsDraft.referralBonus || 0),
      pickupOnlyMultiplier: Number(settingsDraft.pickupOnlyMultiplier || 0),
      distanceIncludedMiles: Number(settingsDraft.distanceIncludedMiles || 0),
      distanceBand1MaxMiles: Number(settingsDraft.distanceBand1MaxMiles || 0),
      distanceBand2MaxMiles: Number(settingsDraft.distanceBand2MaxMiles || 0),
      distanceBand1Rate: Number(settingsDraft.distanceBand1Rate || 0),
      distanceBand2Rate: Number(settingsDraft.distanceBand2Rate || 0),
      distanceBand3Rate: Number(settingsDraft.distanceBand3Rate || 0),
      hubLat: parseNullableNumber(settingsDraft.hubLat),
      hubLng: parseNullableNumber(settingsDraft.hubLng),
      requirePhotoForRefunds: Boolean(settingsDraft.requirePhotoForRefunds),
      allowGuestCheckout: Boolean(settingsDraft.allowGuestCheckout),
      showAdvancedInventoryInsights: Boolean(settingsDraft.showAdvancedInventoryInsights),
      allowPlatinumTier: Boolean(settingsDraft.allowPlatinumTier),
      platinumFreeDelivery: Boolean(settingsDraft.platinumFreeDelivery),
      dailyReturnLimit: Number(settingsDraft.dailyReturnLimit || 0),
      glassHandlingFeePercent: Number(settingsDraft.glassHandlingFeePercent || 0),
      michiganDepositValue: Number(settingsDraft.michiganDepositValue || 0),
      processingFeePercent: Number(settingsDraft.processingFeePercent || 0),
      returnProcessingFeePercent: Number(settingsDraft.returnProcessingFeePercent || 0),
      glassHandlingFeePerContainer: Number(settingsDraft.glassHandlingFeePerContainer || 0),
      returnHandlingFeePerContainer: Number(settingsDraft.returnHandlingFeePerContainer || 0),
    };

    const persistSettings = (payload: AppSettings) => {
      if (typeof window === 'undefined') return false;
      try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    };

    try {
      const res = await fetch(`${BACKEND_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(nextSettings)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save settings');

      const savedSettings = (data?.settings as AppSettings) || nextSettings;
      setSettings(savedSettings);
      persistSettings(savedSettings);
      setSettingsDirty(false);
      setSettingsSaved(true);
    } catch (e: any) {
      const stored = persistSettings(nextSettings);
      if (stored) {
        setSettings(nextSettings);
        setSettingsDirty(false);
        setSettingsSaved(true);
      } else {
        setSettingsError(e?.message || 'Failed to save settings');
      }
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ---- Orders API (OWNER) ----
  const [isRefreshingOrders, setIsRefreshingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const apiRefreshOrders = async () => {
    setOrdersError(null);
    setIsRefreshingOrders(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders`, {
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Orders fetch failed');
      // NOTE:
      // This view receives `orders` from parent state. This button checks connectivity,
      // but does not directly set `orders` here. Your parent core should re-fetch orders
      // on session restore / status updates (which you already have).
    } catch (e: any) {
      setOrdersError(e?.message || 'Orders fetch failed');
    } finally {
      setIsRefreshingOrders(false);
    }
  };

  const handleScannerScan = useCallback(async (upc: string) => {
    setLastBlockedUpc(null);
    setLastBlockedReason(null);
    if (scannerMode === ScannerMode.INVENTORY_CREATE) {
      await handleInventoryScannerScan(upc);
      return;
    }
    if (scannerMode === ScannerMode.UPC_LOOKUP) {
      handleUpcScannerScan(upc);
    }
  }, [handleInventoryScannerScan, handleUpcScannerScan, scannerMode]);

  const startEditProduct = (product: Product) => {
    setEditError(null);
    setEditingProduct(product);
    setEditDraft({
      name: product.name,
      price: product.price,
      deposit: product.deposit,
      stock: product.stock,
      sizeOz: product.sizeOz,
      sizeUnit: product.sizeUnit || 'oz',
      category: product.category,
      brand: product.brand || '',
      productType: product.productType || '',
      nutritionNote: product.nutritionNote || '',
      storageZone: product.storageZone || '',
      storageBin: product.storageBin || '',
      image: product.image,
      isGlass: product.isGlass
    });
  };

  const closeEditProduct = () => {
    setEditError(null);
    setEditingProduct(null);
  };

  const apiUpdateProduct = async () => {
    if (!editingProduct) return;
    setEditError(null);

    const name = editDraft.name.trim();
    const price = Number(editDraft.price);
    const deposit = Number(editDraft.deposit);
    const stock = Number(editDraft.stock);
    const sizeOz = Number(editDraft.sizeOz);
    const sizeUnit = editDraft.sizeUnit;

    if (!name) {
      setEditError('Name is required.');
      return;
    }

    if ([price, deposit, stock, sizeOz].some(value => Number.isNaN(value))) {
      setEditError('Price, deposit, stock, and size must be valid numbers.');
      return;
    }

    const updates: Partial<Product> = {};

    if (name !== editingProduct.name) updates.name = name;
    if (price !== editingProduct.price) updates.price = price;
    if (deposit !== editingProduct.deposit) updates.deposit = deposit;
    if (stock !== editingProduct.stock) updates.stock = stock;
    if (sizeOz !== editingProduct.sizeOz) updates.sizeOz = sizeOz;
    if (sizeUnit !== editingProduct.sizeUnit) updates.sizeUnit = sizeUnit;
    if (editDraft.category !== editingProduct.category) updates.category = editDraft.category;
    if (editDraft.brand !== editingProduct.brand) updates.brand = editDraft.brand;
    if (editDraft.productType !== editingProduct.productType) updates.productType = editDraft.productType;
    if (editDraft.nutritionNote !== editingProduct.nutritionNote) updates.nutritionNote = editDraft.nutritionNote;
    if (editDraft.storageZone !== editingProduct.storageZone) updates.storageZone = editDraft.storageZone;
    if (editDraft.storageBin !== editingProduct.storageBin) updates.storageBin = editDraft.storageBin;
    if (editDraft.image !== editingProduct.image) updates.image = editDraft.image;
    if (editDraft.isGlass !== editingProduct.isGlass) updates.isGlass = editDraft.isGlass;

    if (Object.keys(updates).length === 0) {
      setEditError('No changes to save.');
      return;
    }

    setIsSavingEdit(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/products/${editingProduct.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Update failed');

      const updated: Product = {
        ...data.product,
        sizeUnit: data.product?.sizeUnit || editDraft.sizeUnit,
        nutritionNote: data.product?.nutritionNote || editDraft.nutritionNote
      };
      setProducts(prev => prev.map(p => (p.id === updated.id ? updated : p)));
      setEditingProduct(null);
    } catch (e: any) {
      setEditError(e?.message || 'Update failed');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const apiRestockPlus10 = async (id: string, currentStock: number) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stock: Number(currentStock) + 10 })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Restock failed');

      const updated: Product = {
        ...data.product,
        sizeUnit: data.product?.sizeUnit || (products.find(p => p.id === id)?.sizeUnit ?? 'oz'),
        nutritionNote: data.product?.nutritionNote || products.find(p => p.id === id)?.nutritionNote
      };
      setProducts(prev => prev.map(p => (p.id === id ? updated : p)));
    } catch {
      // silent in UI for now
    }
  };

  const apiDeleteProduct = async (id: string) => {
    const product = products.find(p => p.id === id);
    const productName = product?.name || 'this product';
    if (!confirm(`Delete ${productName}? This will permanently remove the product from inventory.`)) {
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/api/products/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Delete failed');
      setProducts(prev => prev.filter(p => p.id !== id));
    } catch {
      // silent in UI for now
    }
  };

  const apiDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/api/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || 'Delete failed');
      // Refetch users to update the list
      await fetchUsers();
      // Audit log: run inventory audit after user deletion
      if (!auditModel) {
        setAiInsights('No AI model configured for audit.');
        return;
      }
      setIsAuditing(true);
      try {
        const report = await getAdvancedInventoryInsights(
          products as any,
          orders as any,
          auditModel
        );
        setAiInsights(report || 'NO OUTPUT');
      } catch {
        setAiInsights('Audit transmission interrupted.');
      } finally {
        setIsAuditing(false);
      }
    } catch {
      // silent in UI for now
    }
  };

  const runOpsSummary = async () => {
    setIsOpsSummaryLoading(true);
    try {
      const summary = await getOperationsSummary(orders as any, 'latest snapshot', auditModel);
      setOpsSummary(summary || 'No summary generated.');
    } catch {
      setOpsSummary('Ops summary unavailable.');
    } finally {
      setIsOpsSummaryLoading(false);
    }
  };

  const runAuditSummary = async () => {
    if (!auditModel) {
      setAuditSummary('No AI model configured for audit.');
      return;
    }
    setIsAuditSummaryLoading(true);
    setAuditSummary(null);
    try {
      const summary = await getAuditLogSummary(filteredAuditLogs, auditModel);
      setAuditSummary(summary || 'No summary was generated.');
    } catch (e: any) {
      setAuditSummary(`An error occurred: ${e.message}`);
    } finally {
      setIsAuditSummaryLoading(false);
    }
  };

  const canCancel = (o: Order) => {
    // Cancel is allowed for anything not delivered/refunded/closed.
    // Backend will block cancel if already PAID (it returns an error). We keep the UI conservative.
    return (
      o.status !== OrderStatus.DELIVERED &&
      o.status !== OrderStatus.REFUNDED &&
      o.status !== OrderStatus.CLOSED
    );
  };

  useEffect(() => {
    if (activeModule !== 'users') return;
    if (users.length > 0) return;

    let mounted = true;
    setIsUsersLoading(true);
    setUsersError(null);
    fetchUsers()
      .catch((e: any) => {
        if (!mounted) return;
        setUsersError(e?.message || 'Failed to load users');
      })
      .finally(() => {
        if (!mounted) return;
        setIsUsersLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeModule, fetchUsers, users.length]);

  // Load return verifications when reviews module is active
  useEffect(() => {
    if (activeModule !== 'reviews') return;

    let mounted = true;
    setIsReturnVerificationsLoading(true);
    setReturnVerificationsError(null);

    fetchReturnVerifications()
      .then(verifications => {
        if (!mounted) return;
        setReturnVerifications(verifications);
      })
      .catch(e => {
        if (!mounted) return;
        setReturnVerificationsError(e?.message || 'Failed to load return verifications');
      })
      .finally(() => {
        if (!mounted) return;
        setIsReturnVerificationsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeModule, fetchReturnVerifications]);

  const filteredUsers = useMemo(() => {
    const needle = userFilter.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(u =>
      [u.username, u.name, u.role, u.membershipTier]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(needle))
    );
  }, [userFilter, users]);

  const refreshUsers = () => {
    setIsUsersLoading(true);
    setUsersError(null);
    fetchUsers()
      .catch((e: any) => setUsersError(e?.message || 'Failed to load users'))
      .finally(() => setIsUsersLoading(false));
  };

  const handleUserDraftChange = (userId: string, updates: Partial<User>) => {
    setUserDrafts(prev => ({
      ...prev,
      [userId]: { ...prev[userId], ...updates }
    }));
  };

  const fetchUserLedger = async (userId: string) => {
    setLedgerLoading(prev => ({ ...prev, [userId]: true }));
    setLedgerErrors(prev => ({ ...prev, [userId]: null }));
    try {
      const res = await fetch(`${BACKEND_URL}/api/users/${userId}/ledger`, {
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load ledger');
      const entries = Array.isArray(data?.ledger) ? data.ledger : [];
      setUserLedgers(prev => ({ ...prev, [userId]: entries }));
    } catch (e: any) {
      setLedgerErrors(prev => ({
        ...prev,
        [userId]: e?.message || 'Failed to load ledger'
      }));
    } finally {
      setLedgerLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const requestUserStats = async (userId: string) => {
    if (userStatsLoading[userId]) return;
    setUserStatsLoading(prev => ({ ...prev, [userId]: true }));
    try {
      await fetchUserStats(userId);
    } finally {
      setUserStatsLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const toggleUserDetails = (user: User) => {
    const shouldExpand = expandedUserId !== user.id;
    setExpandedUserId(prev => (prev === user.id ? null : user.id));
    setUserDrafts(prev => {
      if (prev[user.id]) return prev;
      return {
        ...prev,
        [user.id]: {
          creditBalance: user.creditBalance,
          loyaltyPoints: user.loyaltyPoints,
          membershipTier: user.membershipTier
        }
      };
    });
    if (shouldExpand && !userLedgers[user.id] && !ledgerLoading[user.id]) {
      fetchUserLedger(user.id);
    }
    if (shouldExpand && !userStats[user.id]) {
      requestUserStats(user.id);
    }
  };

  const saveUserDraft = async (userId: string) => {
    const updates = userDrafts[userId];
    if (!updates) return;
    const clampedUpdates = { ...updates };
    if (clampedUpdates.creditBalance !== undefined) {
      clampedUpdates.creditBalance = Math.max(0, Number(clampedUpdates.creditBalance || 0));
    }
    if (clampedUpdates.loyaltyPoints !== undefined) {
      clampedUpdates.loyaltyPoints = Math.max(0, Number(clampedUpdates.loyaltyPoints || 0));
    }
    try {
      await updateUserProfile(userId, clampedUpdates);
      setUserDrafts(prev => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    } catch {
      // handled by upstream toast
    }
  };

  const handleDownloadAuditCsv = () => {
    const headers = ['type', 'actorId', 'details', 'createdAt'];
    const escapeValue = (value: string) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = filteredAuditLogs.map(log =>
      [log.type, log.actorId, log.details, log.createdAt].map(escapeValue).join(',')
    );
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `audit-logs-${new Date().toISOString()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const managementSections = {
    analytics: {
      id: 'analytics',
      label: 'Dashboard',
      icon: BarChart3,
      render: () => (
        <ManagementDashboard
          auditModel={auditModel}
          auditModels={auditModels}
          auditModelsError={auditModelsError}
          isAuditModelsLoading={isAuditModelsLoading}
          isAuditing={isAuditing}
          isOpsSummaryLoading={isOpsSummaryLoading}
          orders={orders}
          aiInsights={aiInsights}
          opsSummary={opsSummary}
          chartData={chartData}
          isChartReady={isChartReady}
          isChartVisible={isChartVisible}
          chartContainerRef={chartContainerRef}
          setAuditModel={setAuditModel}
          // runAudit prop removed because runAudit is not defined
          runOpsSummary={runOpsSummary}
        />
      )
    },
    orders: {
      id: 'orders',
      label: 'Orders',
      icon: Truck,
      render: () => (
        <ManagementOrders
          orders={orders}
          users={users}
          isRefreshingOrders={isRefreshingOrders}
          ordersError={ordersError}
          apiRefreshOrders={apiRefreshOrders}
          handleLogisticsUpdate={handleLogisticsUpdate}
          canCancel={canCancel}
          fmtTime={fmtTime}
          countTotalUpcs={countTotalUpcs}
        />
      )
    },
    reviews: {
      id: 'reviews',
      label: 'Reviews',
      icon: ShieldCheck,
      render: () => (
        <ManagementApprovals
          approvalFilter={approvalFilter}
          setApprovalFilter={setApprovalFilter}
          filteredApprovals={filteredApprovals}
          handleApprove={handleApprove}
          handleReject={handleReject}
          setSelectedApproval={setSelectedApproval}
          setPreviewPhoto={setPreviewPhoto}
          fmtTime={fmtTime}
        />
      )
    },
    inventory: {
      id: 'inventory',
      label: 'Inventory',
      icon: Package,
      render: () => (
        <ManagementInventory
          scannerMode={scannerMode}
          setScannerMode={setScannerMode}
          scannerModalOpen={scannerModalOpen}
          setScannerModalOpen={setScannerModalOpen}
          lastBlockedUpc={lastBlockedUpc}
          lastBlockedReason={lastBlockedReason}
          handleScannerScan={handleScannerScan}
          setLastBlockedUpc={setLastBlockedUpc}
          setLastBlockedReason={setLastBlockedReason}
          scannedUpcForCreation={scannedUpcForCreation}
          setScannedUpcForCreation={setScannedUpcForCreation}
          handleManualUpcChange={handleManualUpcChange}
          fetchOffLookup={fetchOffLookup}
          offLookupStatus={offLookupStatus}
          offLookupMessage={offLookupMessage}
          createError={createError}
          newProduct={newProduct}
          setNewProduct={setNewProduct}
          upcDraft={upcDraft}
          setUpcDraft={setUpcDraft}
          sizeUnitOptions={SIZE_UNIT_OPTIONS}
          offLookupIngredients={offLookupIngredients}
          offNutritionEntries={offNutritionEntries}
          handleCancelCreate={handleCancelCreate}
          apiCreateProduct={apiCreateProduct}
          isCreating={isCreating}
          isDirty={isDirty}
          setIsDirty={setIsDirty}
          pendingUpc={pendingUpc}
          setPendingUpc={setPendingUpc}
          draftStatus={draftStatus}
          setDraftStatus={setDraftStatus}
          batchMode={batchMode}
          toggleBatchMode={toggleBatchMode}
          batchQueue={batchQueue}
          setBatchQueue={setBatchQueue}
          addBatchQueueToRegistry={addBatchQueueToRegistry}
          inventorySort={inventorySort}
          setInventorySort={setInventorySort}
          sortedProducts={sortedProducts}
          startEditProduct={startEditProduct}
          apiRestockPlus10={apiRestockPlus10}
          apiDeleteProduct={apiDeleteProduct}
          formatSize={formatSize}
        />
      )
    },
    upc: {
      id: 'upc',
      label: 'UPC Registry',
      icon: ScanLine,
      render: () => (
        <ManagementUpcRegistry
          upcItems={upcItems}
          setUpcItems={setUpcItems}
          upcInput={upcInput}
          setUpcInput={setUpcInput}
          upcDraft={upcDraft}
          setUpcDraft={setUpcDraft}
          upcFilter={upcFilter}
          setUpcFilter={setUpcFilter}
          isUpcLoading={isUpcLoading}
          isUpcSaving={isUpcSaving}
          upcError={upcError}
          apiLoadUpcItems={apiLoadUpcItems}
          handleUpcLookup={handleUpcLookup}
          apiSaveUpc={apiSaveUpc}
          apiDeleteUpc={apiDeleteUpc}
          apiDeleteUpcDirect={apiDeleteUpcDirect}
          apiLinkUpc={apiLinkUpc}
          filteredUpcItems={filteredUpcItems}
          loadUpcDraft={loadUpcDraft}
          products={products}
          unmappedUpcModalOpen={unmappedUpcModalOpen}
          setUnmappedUpcModalOpen={setUnmappedUpcModalOpen}
          unmappedUpcPayload={unmappedUpcPayload}
          setUnmappedUpcPayload={setUnmappedUpcPayload}
          ScannerModal={null}
          UPC_CONTAINER_LABELS={UPC_CONTAINER_LABELS}
        />
      )
    },
    users: {
      id: 'users',
      label: 'Users',
      icon: Users,
      render: () => (
        <ManagementUsers
          currentUser={user}
          users={users}
          filteredUsers={filteredUsers}
          userStats={userStats}
          userDrafts={userDrafts}
          expandedUserId={expandedUserId}
          setExpandedUserId={setExpandedUserId}
          userLedgers={userLedgers}
          ledgerLoading={ledgerLoading}
          ledgerErrors={ledgerErrors}
          userStatsLoading={userStatsLoading}
          userFilter={userFilter}
          setUserFilter={setUserFilter}
          isUsersLoading={isUsersLoading}
          usersError={usersError}
          refreshUsers={refreshUsers}
          handleUserDraftChange={handleUserDraftChange}
          fetchUserLedger={fetchUserLedger}
          toggleUserDetails={toggleUserDetails}
          saveUserDraft={saveUserDraft}
          apiDeleteUser={apiDeleteUser}
          allowPlatinumTier={allowPlatinumTier}
          fmtTime={fmtTime}
          fmtDelta={fmtDelta}
          getTierStyles={getTierStyles}
          isNewSignupWithBonus={isNewSignupWithBonus}
        />
      )
    },
    logs: {
      id: 'logs',
      label: 'Audit Logs',
      icon: Terminal,
      render: () => (
        <ManagementAuditLogs
          filteredAuditLogs={filteredAuditLogs}
          auditTypeFilter={auditTypeFilter}
          setAuditTypeFilter={setAuditTypeFilter}
          auditActorFilter={auditActorFilter}
          setAuditActorFilter={setAuditActorFilter}
          auditRangeFilter={auditRangeFilter}
          setAuditRangeFilter={setAuditRangeFilter}
          auditTypeOptions={auditTypeOptions}
          isAuditLogsLoading={isAuditLogsLoading}
          auditLogsError={auditLogsError}
          handleDownloadAuditCsv={handleDownloadAuditCsv}
          runAuditSummary={runAuditSummary}
          auditSummary={auditSummary}
          isAuditSummaryLoading={isAuditSummaryLoading}
          fmtTime={fmtTime}
        />
      )
    },
    settings: {
      id: 'settings',
      label: 'Settings',
      icon: Sliders,
      render: () => (
        <ManagementSettings
          settingsDraft={settingsDraft}
          setSettingsDraft={setSettingsDraft}
          settingsDirty={settingsDirty}
          setSettingsDirty={setSettingsDirty}
          isSavingSettings={isSavingSettings}
          setIsSavingSettings={setIsSavingSettings}
          settingsError={settingsError}
          setSettingsError={setSettingsError}
          settingsSaved={settingsSaved}
          setSettingsSaved={setSettingsSaved}
          updateSettingsDraft={updateSettingsDraft}
          saveSettings={saveSettings}
        />
      )
    }
  } as const;

  const sectionList = Object.values(managementSections);
  const activeSection = managementSections[activeModule as keyof typeof managementSections];

  return (
    <div className="overflow-visible md:overflow-y-auto md:h-[calc(100vh-12rem)]">
      <div className="flex flex-col md:flex-row gap-12 animate-in fade-in">
        <nav className="md:hidden -mx-4 px-4">
          <div className="flex gap-2 overflow-x-auto whitespace-nowrap pb-2">
            {sectionList.map(section => (
              <button
                key={section.id}
                type="button"
                onClick={() => handleModuleSelect(section.id)}
                className={`shrink-0 text-left px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-3 ${
                  activeModule === section.id
                    ? 'bg-ninpo-lime text-ninpo-black shadow-neon'
                    : 'hover:bg-white/5 text-slate-500'
                }`}
              >
                <section.icon className="w-4 h-4" /> {section.label}
              </button>
            ))}
          </div>
        </nav>

        <aside className="hidden md:block w-full md:w-72 space-y-2 md:sticky md:top-6 md:self-start md:shrink-0">
          {sectionList.map(section => (
            <button
              key={section.id}
              type="button"
              onClick={() => handleModuleSelect(section.id)}
              className={`w-full text-left p-5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-4 ${
                activeModule === section.id
                  ? 'bg-ninpo-lime text-ninpo-black shadow-neon'
                  : 'hover:bg-white/5 text-slate-500'
              }`}
            >
              <section.icon className="w-5 h-5" /> {section.label}
            </button>
          ))}
        </aside>

        <div className="flex-1 w-full space-y-8 pb-32">
          {activeSection?.render()}
        </div>

        {editingProduct && (
          <div
            className="fixed inset-0 z-[14000] flex items-center justify-center p-6 bg-ninpo-black/95 backdrop-blur-xl animate-in fade-in duration-300"
            onClick={closeEditProduct}
          >
            <div
              className="w-full max-w-2xl bg-ninpo-card border border-white/10 rounded-[2.5rem] p-8 space-y-6"
              onClick={e => e.stopPropagation()}
            >
              <div>
                <p className="text-white font-black uppercase tracking-widest text-sm">
                  Edit Product
                </p>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mt-2">
                  ID: {editingProduct.id}
                </p>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-2">
                  Storage zone/bin = item location (e.g., Fridge / Shelf A).
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  id="editProductName"
                  name="editProductName"
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Name"
                  value={editDraft.name}
                  onChange={e => setEditDraft({ ...editDraft, name: e.target.value })}
                />
                <input
                  id="editProductCategory"
                  name="editProductCategory"
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Category"
                  value={editDraft.category}
                  onChange={e => setEditDraft({ ...editDraft, category: e.target.value })}
                />
                <input
                  id="editProductBrand"
                  name="editProductBrand"
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Brand"
                  value={editDraft.brand}
                  onChange={e => setEditDraft({ ...editDraft, brand: e.target.value })}
                />
                <input
                  id="editProductType"
                  name="editProductType"
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Product Type"
                  value={editDraft.productType}
                  onChange={e => setEditDraft({ ...editDraft, productType: e.target.value })}
                />
                <textarea
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white md:col-span-2 min-h-[96px]"
                  placeholder="Nutrition note (Customer Info)"
                  value={editDraft.nutritionNote}
                  onChange={e => setEditDraft({ ...editDraft, nutritionNote: e.target.value })}
                />
                <input
                  id="editProductStorageZone"
                  name="editProductStorageZone"
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Storage Zone"
                  value={editDraft.storageZone}
                  onChange={e => setEditDraft({ ...editDraft, storageZone: e.target.value })}
                />
                <input
                  id="editProductStorageBin"
                  name="editProductStorageBin"
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Storage Bin"
                  value={editDraft.storageBin}
                  onChange={e => setEditDraft({ ...editDraft, storageBin: e.target.value })}
                />
                <input
                  id="editProductPrice"
                  name="editProductPrice"
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Price"
                  type="number"
                  value={editDraft.price}
                  onChange={e =>
                    setEditDraft({
                      ...editDraft,
                      price: Number(e.target.value)
                    })
                  }
                />
                <input
                  id="editProductDeposit"
                  name="editProductDeposit"
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Deposit"
                  type="number"
                  value={editDraft.deposit}
                  onChange={e =>
                    setEditDraft({
                      ...editDraft,
                      deposit: Number(e.target.value)
                    })
                  }
                />
                <input
                  id="editProductStock"
                  name="editProductStock"
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Stock"
                  type="number"
                  value={editDraft.stock}
                  onChange={e =>
                    setEditDraft({
                      ...editDraft,
                      stock: Number(e.target.value)
                    })
                  }
                />
                <div className="flex gap-2">
                  <input
                    id="editProductSizeOz"
                    name="editProductSizeOz"
                    className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                    placeholder="Size"
                    type="number"
                    step="0.1"
                    value={editDraft.sizeOz}
                    onChange={e =>
                      setEditDraft({
                        ...editDraft,
                        sizeOz: Number(e.target.value)
                      })
                    }
                  />
                  <select
                    className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                    value={editDraft.sizeUnit}
                    onChange={e =>
                      setEditDraft({
                        ...editDraft,
                        sizeUnit: e.target.value as SizeUnit
                      })
                    }
                  >
                    {SIZE_UNIT_OPTIONS.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white">
                  <input
                    id="edit-is-glass"
                    name="editProductIsGlass"
                    type="checkbox"
                    className="h-4 w-4 accent-ninpo-lime"
                    checked={editDraft.isGlass}
                    onChange={e => setEditDraft({ ...editDraft, isGlass: e.target.checked })}
                  />
                  <label htmlFor="edit-is-glass" className="text-[11px] font-bold">
                    Glass Bottle
                  </label>
                </div>
                <input
                  id="editProductImage"
                  name="editProductImage"
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white md:col-span-2"
                  placeholder="Image URL"
                  value={editDraft.image}
                  onChange={e => setEditDraft({ ...editDraft, image: e.target.value })}
                />
              </div>

              {editError && (
                <div className="bg-ninpo-card p-4 rounded-2xl border border-ninpo-red/20 text-[11px] text-ninpo-red">
                  {editError}
                </div>
              )}

              <div className="flex flex-col md:flex-row gap-3">
                <button
                  onClick={closeEditProduct}
                  className="w-full py-4 rounded-2xl bg-ninpo-red/10 text-ninpo-red text-[10px] font-black uppercase tracking-widest border border-ninpo-red/20 hover:bg-ninpo-red/20 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={apiUpdateProduct}
                  disabled={isSavingEdit}
                  className="w-full py-4 rounded-2xl bg-white/20 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  {isSavingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {previewPhoto && (
          <div
            className="fixed inset-0 z-[15000] flex items-center justify-center p-6 bg-ninpo-black/95 backdrop-blur-xl animate-in fade-in duration-300"
            onClick={() => setPreviewPhoto(null)}
          >
            <div
              className="relative max-w-4xl w-full aspect-video rounded-[3rem] overflow-hidden border border-white/10 shadow-neon bg-black"
              onClick={e => e.stopPropagation()}
            >
              <img src={previewPhoto} className="w-full h-full object-contain" alt="Verification proof" />
              <button
                className="absolute top-10 right-10 p-5 bg-white/10 rounded-3xl text-white hover:bg-ninpo-red transition-colors backdrop-blur-md"
                onClick={() => setPreviewPhoto(null)}
              >
                <EyeOff className="w-7 h-7" />
              </button>
            </div>
          </div>
        )}

        {selectedApproval && (
          <div
            className="fixed inset-0 z-[14000] flex items-center justify-center p-6 bg-ninpo-black/80 backdrop-blur-xl animate-in fade-in duration-300"
            onClick={() => setSelectedApproval(null)}
          >
            <div
              className="relative max-w-4xl w-full rounded-[3rem] overflow-hidden border border-white/10 shadow-neon bg-ninpo-card p-8 space-y-6"
              onClick={event => event.stopPropagation()}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <p className="text-white font-black uppercase tracking-widest text-[12px]">
                    {selectedApproval.type} • {selectedApproval.status}
                  </p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase mt-2 tracking-widest">
                    USER: {selectedApproval.userId} • AMOUNT: $
                    {selectedApproval.amount.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-widest">
                    ORDER: {selectedApproval.orderId || 'N/A'} • REQUESTED: {fmtTime(selectedApproval.createdAt)}
                  </p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-widest">
                    REASON: {selectedApproval.reason || '—'}
                  </p>
                </div>
                <button
                  className="px-5 py-3 rounded-2xl bg-ninpo-red/10 text-ninpo-red text-[10px] font-black uppercase tracking-widest border border-ninpo-red/20 hover:bg-ninpo-red/20 transition"
                  onClick={() => setSelectedApproval(null)}
                >
                  Close
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2 text-[11px] text-slate-300 uppercase tracking-widest">
                <div className="bg-black/30 rounded-2xl p-4 border border-white/5">
                  <p className="text-slate-500 font-bold">Reason</p>
                  <p className="text-white font-semibold mt-2">{selectedApproval.reason || '—'}</p>
                </div>
                <div className="bg-black/30 rounded-2xl p-4 border border-white/5">
                  <p className="text-slate-500 font-bold">Order ID</p>
                  <p className="text-white font-semibold mt-2">
                    {selectedApproval.orderId || 'N/A'}
                  </p>
                </div>
                <div className="bg-black/30 rounded-2xl p-4 border border-white/5">
                  <p className="text-slate-500 font-bold">Created</p>
                  <p className="text-white font-semibold mt-2">
                    {fmtTime(selectedApproval.createdAt)}
                  </p>
                </div>
                <div className="bg-black/30 rounded-2xl p-4 border border-white/5">
                  <p className="text-slate-500 font-bold">Processed</p>
                  <p className="text-white font-semibold mt-2">
                    {selectedApproval.processedAt ? fmtTime(selectedApproval.processedAt) : '—'}
                  </p>
                </div>
              </div>

              {selectedApproval.photoProof && (
                <div className="space-y-3">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                    Photo Proof
                  </p>
                  <button
                    className="w-full rounded-[2rem] overflow-hidden border border-white/10 bg-black"
                    onClick={() => setPreviewPhoto(selectedApproval.photoProof!)}
                  >
                    <img
                      src={selectedApproval.photoProof}
                      alt="Approval proof"
                      className="w-full max-h-[320px] object-cover"
                    />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {unmappedUpcModalOpen && unmappedUpcPayload && (
          <UnmappedUpcModal
            key={unmappedUpcPayload.upc}
            data={unmappedUpcPayload}
            products={products}
            onClose={() => setUnmappedUpcModalOpen(false)}
            onCreateProduct={async productData => {
              setNewProduct(prev => ({ ...prev, ...productData }));
              setUpcDraft(prev => ({
                ...prev,
                name: productData.name,
                sizeOz: productData.sizeOz,
                sizeUnit: productData.sizeUnit
              }));
              const newProd = await apiCreateProduct();
              if (newProd) {
                await apiLinkUpc(unmappedUpcPayload.upc, newProd.id);
              }
              setUnmappedUpcModalOpen(false);
            }}
            onAttachToExisting={async (productId) => {
              await apiLinkUpc(unmappedUpcPayload.upc, productId);
              setUnmappedUpcModalOpen(false);
            }}
          />
        )}

        <ScannerModal
          mode={scannerMode}
          onScan={handleScannerScan}
          onClose={() => {
            setScannerModalOpen(false);
            setLastBlockedUpc(null);
            setLastBlockedReason(null);
          }}
          onCooldown={(upc, reason) => {
            addToast('Same UPC — tap to add again', 'info');
            if (reason === 'duplicate') {
              setLastBlockedUpc(upc);
              setLastBlockedReason(reason);
            } else {
              setLastBlockedUpc(null);
              setLastBlockedReason(reason);
            }
          }}
          title={
            scannerMode === ScannerMode.INVENTORY_CREATE ? 'Scan Product' :
            scannerMode === ScannerMode.UPC_LOOKUP ? 'Scan UPC' :
            'Scan'
          }
          subtitle={
            scannerMode === ScannerMode.INVENTORY_CREATE ? 'Scan UPC to auto-fill product details' :
            scannerMode === ScannerMode.UPC_LOOKUP ? 'Scan UPC to lookup or edit registry entry' :
            'Scan barcode'
          }
          beepEnabled={settings.beepEnabled ?? true}
          cooldownMs={settings.cooldownMs ?? 1000}
          isOpen={scannerModalOpen}
          bottomSheetContent={
            scannerMode === ScannerMode.INVENTORY_CREATE ? (
              <InventoryCreateForm
                scannedUpcForCreation={scannedUpcForCreation}
                setScannedUpcForCreation={setScannedUpcForCreation}
                handleManualUpcChange={handleManualUpcChange}
                fetchOffLookup={fetchOffLookup}
                offLookupStatus={offLookupStatus}
                handleAddToUpcRegistry={handleAddToUpcRegistry}
                offLookupMessage={offLookupMessage}
                createError={createError}
                newProduct={newProduct}
                setNewProduct={setNewProduct}
                upcDraft={upcDraft}
                setUpcDraft={setUpcDraft}
                sizeUnitOptions={SIZE_UNIT_OPTIONS}
                offLookupIngredients={offLookupIngredients}
                offNutritionEntries={offNutritionEntries}
                handleCancelCreate={handleCancelCreate}
                apiCreateProduct={apiCreateProduct}
                isCreating={isCreating}
                isDirty={isDirty}
                setIsDirty={setIsDirty}
                pendingUpc={pendingUpc}
                setPendingUpc={setPendingUpc}
                draftStatus={draftStatus}
                setDraftStatus={setDraftStatus}
                batchMode={batchMode}
                toggleBatchMode={toggleBatchMode}
                batchQueue={batchQueue}
                setBatchQueue={setBatchQueue}
                addBatchQueueToRegistry={addBatchQueueToRegistry}
              />
            ) : null
          }
          closeOnScan={false}
        />
      </div>
    </div>
  );
};

export default ManagementView;
