import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
} from '../types';

// Type-only imports for TSX type references
import type {
  UserStatsSummary,
  AuditLog,
  LedgerEntry,
  AuditLogType,
  User,
  Product,
  Order,
  UpcContainerType,
  UpcItem,
  AppSettings,
  ApprovalRequest,
  ReturnUpcCount,
  ReturnVerification,
  ReturnSettlement,
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
import {
  Truck,
  Package,
  Users,
  BarChart3,
  ShieldCheck,
  CheckCircle2,
  BrainCircuit,
  Loader2,
  Terminal,
  Sliders,
  ShieldAlert,
  Navigation2,
  PackageCheck,
  EyeOff,
  PackageX,
  Plus,
  RefreshCw,
  UserCheck,
  XCircle,
  ScanLine,
  X
} from 'lucide-react';
import InlineScanner from '../components/InlineScanner';
import ScannerModal from '../components/ScannerModal';
import UnmappedUpcModal from '../components/UnmappedUpcModal';
import { UnmappedUpcData } from '../types';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import {
  getAdvancedInventoryInsights,
  analyzeProductScan,
  getAvailableAuditModels,
  getOperationsSummary,
  type ProductScanResult
} from '../services/geminiService';

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';
const SETTINGS_STORAGE_KEY = 'ninpo:settings';
const UPC_CONTAINER_LABELS: Record<UpcContainerType, string> = {
  aluminum: 'CAN / ALUMINUM',
  glass: 'GLASS / BOTTLE',
  plastic: 'PLASTIC / BOTTLE'
};
const SIZE_UNIT_OPTIONS: SizeUnit[] = ['oz', 'fl oz', 'g', 'kg', 'ml', 'l'];
const AI_ANALYSIS_FALLBACK_MESSAGE = 'AI analysis failed. Please retake the photo.';
const INVALID_PHOTO_MESSAGE = 'Invalid photo data. Please retake.';
const DEFAULT_NEW_PRODUCT = {
  id: '',
  name: '',
  price: 0,
  deposit: 0,
  stock: 0,
  sizeOz: 0,
  sizeUnit: 'oz' as SizeUnit,
  category: 'DRINK',
  brand: '',
  productType: '',
  nutritionNote: '',
  storageZone: '',
  storageBin: '',
  image: '',
  isGlass: false
};

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

const fmtTime = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

const fmtDelta = (value: number) => {
  const normalized = Number(value || 0);
  const formatted = Math.abs(normalized).toLocaleString(undefined, {
    maximumFractionDigits: 2
  });
  return `${normalized >= 0 ? '+' : '-'}${formatted}`;
};

const getTierStyles = (tier: string) => {
  switch (tier) {
    case 'COMMON':
      return 'border-slate-500/40 bg-slate-800/30 text-slate-300';
    case 'SILVER':
      return 'border-slate-300/40 bg-slate-400/20 text-slate-200';
    case 'GOLD':
      return 'border-yellow-400/40 bg-yellow-500/20 text-yellow-200';
    case 'PLATINUM':
      return 'border-indigo-400/40 bg-indigo-500/20 text-indigo-200';
    case 'BRONZE':
    default:
      return 'border-amber-500/40 bg-amber-700/30 text-amber-200';
  }
};

const countTotalUpcs = (entries: ReturnUpcCount[]) =>
  entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);

const formatSize = (value: number, unit?: SizeUnit) => {
  if (!value) return 'No size';
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return 'No size';
  const label = unit || 'oz';
  const decimals = label === 'oz' || label === 'fl oz' ? 1 : 0;
  return `${normalized.toFixed(decimals)} ${label}`;
};

const isNewSignupWithBonus = (user: User) => {
  const createdAt = user.createdAt ? new Date(user.createdAt) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
  const ageMs = Date.now() - createdAt.getTime();
  return Number(user.loyaltyPoints || 0) >= 100 && ageMs < 24 * 60 * 60 * 1000;
};

const isLikelyJsonPayload = (value: string) => {
  const trimmed = value.trim();
  if (
    !(
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    )
  ) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
};

const sanitizeAiMessage = (message: string | null | undefined) => {
  if (!message) return null;
  const trimmed = message.trim();
  const isLargePayload = trimmed.length > 240;
  if (isLargePayload || isLikelyJsonPayload(trimmed)) {
    return AI_ANALYSIS_FALLBACK_MESSAGE;
  }
  return trimmed;
};

const extractBase64FromDataUrl = (photoDataUrl: string) => {
  if (!photoDataUrl.startsWith('data:') || !photoDataUrl.includes(';base64,')) {
    return '';
  }
  const [, base64Data] = photoDataUrl.split(',', 2);
  return base64Data?.replace(/\s+/g, '') ?? '';
};

const isLikelyBase64 = (value: string) => /^[A-Za-z0-9+/_-]+={0,2}$/.test(value);

const isValidPhotoDataUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith('data:image/')) return false;
  const base64Data = extractBase64FromDataUrl(trimmed);
  if (!base64Data) return false;
  return isLikelyBase64(base64Data);
};

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
  const [auditModel, setAuditModel] = useState('');
  const [auditModels, setAuditModels] = useState<string[]>([]);
  const [isAuditModelsLoading, setIsAuditModelsLoading] = useState(false);
  const [auditModelsError, setAuditModelsError] = useState<string | null>(null);
  const [opsSummary, setOpsSummary] = useState('');
  const [isOpsSummaryLoading, setIsOpsSummaryLoading] = useState(false);
  const [inventoryMode, setInventoryMode] = useState<'A' | 'B'>('A');
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [auditId, setAuditId] = useState<string>('current-audit');
  const [auditCounts, setAuditCounts] = useState<Record<string, number>>({});
  const [auditUpcInput, setAuditUpcInput] = useState('');
  const [auditError, setAuditError] = useState<string | null>(null);
  const [scannerModalOpen, setScannerModalOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<ScannerMode>(ScannerMode.INVENTORY_CREATE);
  const [scannedUpcForCreation, setScannedUpcForCreation] = useState<string>('');
  const [unmappedUpcModalOpen, setUnmappedUpcModalOpen] = useState(false);
  const [unmappedUpcPayload, setUnmappedUpcPayload] = useState<UnmappedUpcData | null>(null);
  const isInlineInventoryScanner = activeModule === 'inventory' && inventoryMode === 'A';

  // Return verifications state
  const [returnVerifications, setReturnVerifications] = useState<ReturnVerification[]>([]);
  const [isReturnVerificationsLoading, setIsReturnVerificationsLoading] = useState(false);
  const [returnVerificationsError, setReturnVerificationsError] = useState<string | null>(null);
  const [settlingVerificationId, setSettlingVerificationId] = useState<string | null>(null);

  const handleModuleSelect = (moduleId: string) => {
    setActiveModule(moduleId);
  };

  useEffect(() => {
    if (!isInlineInventoryScanner) return;
    if (scannerMode !== ScannerMode.INVENTORY_CREATE) {
      setScannerMode(ScannerMode.INVENTORY_CREATE);
    }
    if (scannerModalOpen) {
      setScannerModalOpen(false);
    }
  }, [isInlineInventoryScanner, scannerMode, scannerModalOpen]);

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
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState({ ...DEFAULT_NEW_PRODUCT });
  const [labelScanPhoto, setLabelScanPhoto] = useState<string | null>(null);
  const [labelScanMime, setLabelScanMime] = useState<string | null>(null);
  const [labelScanResult, setLabelScanResult] = useState<ProductScanResult | null>(
    null
  );
  const [labelScanError, setLabelScanError] = useState<string | null>(null);
  const [isLabelScanning, setIsLabelScanning] = useState(false);
  const sanitizedLabelScanError = useMemo(
    () => sanitizeAiMessage(labelScanError),
    [labelScanError]
  );
  const sanitizedLabelScanMessage = useMemo(
    () => sanitizeAiMessage(labelScanResult?.message),
    [labelScanResult?.message]
  );
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
  const [upcItems, setUpcItems] = useState<UpcItem[]>([]);
  const [upcInput, setUpcInput] = useState('');
  const [upcFilter, setUpcFilter] = useState('');
  const [upcDraft, setUpcDraft] = useState<UpcItem>({
    upc: '',
    name: '',
    depositValue: 0.1,
    price: 0,
    containerType: 'plastic',
    sizeOz: 0,
    sizeUnit: 'oz',
    isEligible: true
  });
  const [isUpcLoading, setIsUpcLoading] = useState(false);
  const [isUpcSaving, setIsUpcSaving] = useState(false);
  const [upcError, setUpcError] = useState<string | null>(null);
  const [approvalFilter, setApprovalFilter] =
    useState<ApprovalRequest['status']>('PENDING');
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      labelScanError &&
      sanitizedLabelScanError === AI_ANALYSIS_FALLBACK_MESSAGE
    ) {
      console.error('Label scan error details:', labelScanError);
    }
  }, [labelScanError, sanitizedLabelScanError]);

  useEffect(() => {
    if (
      labelScanResult?.message &&
      sanitizedLabelScanMessage === AI_ANALYSIS_FALLBACK_MESSAGE
    ) {
      console.error(
        'Label scan result message details:',
        labelScanResult.message
      );
    }
  }, [labelScanResult?.message, sanitizedLabelScanMessage]);

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

  const upcLastScannedRef = useRef<string>('');
  const upcItemsRef = useRef<UpcItem[]>([]);
  const upcDepositRef = useRef<number>(0.1);
  const upcAudioContextRef = useRef<AudioContext | null>(null);

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
      platinumFreeDelivery: Boolean(settingsDraft.platinumFreeDelivery)
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

  // ---- UPC Registry Maintenance API (OWNER) ----
  const apiLoadUpcItems = async () => {
    setUpcError(null);
    setIsUpcLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc`, {
        method: 'GET',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load UPC list');
      setUpcItems(Array.isArray(data?.upcItems) ? data.upcItems : []);
    } catch (e: any) {
      setUpcError(e?.message || 'Failed to load UPC list');
    } finally {
      setIsUpcLoading(false);
    }
  };

  const loadUpcDraft = (entry: UpcItem) => {
    setUpcDraft({
      upc: entry.upc,
      name: entry.name || '',
      depositValue: 0.1,
      price: Number(entry.price || 0),
      containerType: entry.containerType || 'plastic',
      sizeOz: Number(entry.sizeOz || 0),
      sizeUnit: entry.sizeUnit || 'oz',
      isEligible: entry.isEligible !== false
    });
  };

  const handleUpcLookup = (upc?: string) => {
    const targetUpc = upc || upcInput.trim();
    if (!targetUpc) {
      setUpcError('UPC is required.');
      return;
    }

    setUpcError(null);
    const existing = upcItems.find(item => item.upc === targetUpc);
    if (existing) {
      loadUpcDraft(existing);
      return;
    }

    setUpcDraft({
      upc: targetUpc,
      name: '',
      depositValue: 0.1,
      price: 0,
      containerType: 'plastic',
      sizeOz: 0,
      sizeUnit: 'oz',
      isEligible: true
    });
  };

  const apiSaveUpc = async () => {
    if (!upcDraft.upc) {
      setUpcError('UPC is required.');
      return;
    }

    setIsUpcSaving(true);
    setUpcError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          upc: upcDraft.upc,
          name: upcDraft.name,
          depositValue: Number(upcDraft.depositValue || 0),
          price: Number(upcDraft.price || 0),
          containerType: upcDraft.containerType,
          sizeOz: Number(upcDraft.sizeOz || 0),
          sizeUnit: upcDraft.sizeUnit,
          isEligible: upcDraft.isEligible
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save UPC');
      const saved: UpcItem = {
        ...data.upcItem,
        sizeUnit: data.upcItem?.sizeUnit || upcDraft.sizeUnit
      };
      setUpcItems(prev => {
        const next = prev.filter(item => item.upc !== saved.upc);
        return [saved, ...next];
      });
      // Clear inputs after successful save
      setUpcInput('');
      setUpcDraft({
        upc: '',
        name: '',
        depositValue: 0.1,
        price: 0,
        containerType: 'plastic',
        sizeOz: 0,
        sizeUnit: 'oz',
        isEligible: true
      });
    } catch (e: any) {
      setUpcError(e?.message || 'Failed to save UPC');
    } finally {
      setIsUpcSaving(false);
    }
  };

  const apiDeleteUpc = async () => {
    if (!upcDraft.upc) return;
    setIsUpcSaving(true);
    setUpcError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc/${upcDraft.upc}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to delete UPC');
      setUpcItems(prev => prev.filter(item => item.upc !== upcDraft.upc));
      // Invalidate caches
      try { localStorage.removeItem('ninpo_upc_eligibility_v1'); } catch {}
      setUpcDraft({
        upc: '',
        name: '',
        depositValue: 0.1,
        price: 0,
        containerType: 'plastic',
        sizeOz: 0,
        isEligible: true
      });
      setUpcInput('');
    } catch (e: any) {
      setUpcError(e?.message || 'Failed to delete UPC');
    } finally {
      setIsUpcSaving(false);
    }
  };

  const apiLinkUpc = async (upc: string, productId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ upc, productId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Link failed');
    } catch (e: any) {
      setUpcError(e?.message || 'Link failed');
    }
  };

  useEffect(() => {
    if (activeModule === 'upc' && upcItems.length === 0 && !isUpcLoading) {
      apiLoadUpcItems();
    }
  }, [activeModule, upcItems.length, isUpcLoading]);

  useEffect(() => {
    upcItemsRef.current = upcItems;
  }, [upcItems]);

  const filteredUpcItems = useMemo(() => {
    const needle = upcFilter.trim().toLowerCase();
    if (!needle) return upcItems;
    return upcItems.filter(item => {
      return (
        item.upc.toLowerCase().includes(needle) ||
        (item.name || '').toLowerCase().includes(needle)
      );
    });
  }, [upcFilter, upcItems]);

  const apiScanUpc = async (upc: string, qty = 1, resolveOnly = false) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ upc, qty, resolveOnly })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Scan failed');

      if (data.action === 'unmapped') {
        const { upc, upcEntry } = data;
        setUnmappedUpcPayload({
          upc,
          name: upcEntry?.name,
          price: upcEntry?.price,
          deposit: upcEntry?.depositValue,
          sizeOz: upcEntry?.sizeOz
        });
        setUnmappedUpcModalOpen(true);
        return data;
      }

      if (!resolveOnly) {
        if (data.action === 'updated' && data.product) {
          const prod: Product = {
            id: data.product.sku || data.product.frontendId,
            sku: data.product.sku || undefined,
            name: data.product.name,
            price: data.product.price,
            deposit: data.product.deposit ?? 0,
            stock: data.product.stock ?? 0,
            sizeOz: data.product.sizeOz ?? 0,
            category: data.product.category ?? 'DRINK',
            image: data.product.image || '',
            brand: data.product.brand || '',
            productType: data.product.productType || '',
            storageZone: data.product.storageZone || '',
            storageBin: data.product.storageBin || '',
            isGlass: !!data.product.isGlass
          };
          setProducts(prev => prev.map(p => (p.id === prod.id ? prod : p)));
        }

        if (data.action === 'created' && data.product) {
          const created: Product = {
            id: data.product.sku || data.product.frontendId,
            sku: data.product.sku || undefined,
            name: data.product.name,
            price: data.product.price,
            deposit: data.product.deposit ?? 0,
            stock: data.product.stock ?? 0,
            sizeOz: data.product.sizeOz ?? 0,
            category: data.product.category ?? 'DRINK',
            image: data.product.image || '',
            brand: data.product.brand || '',
            productType: data.product.productType || '',
            storageZone: data.product.storageZone || '',
            storageBin: data.product.storageBin || '',
            isGlass: !!data.product.isGlass
          };
          setProducts(prev => [created, ...prev]);
        }
      }

      return data;
    } catch (e: any) {
      setUpcError(e?.message || 'Scan failed');
      return null;
    }
  };

  const applyLabelScanToDrafts = (result: ProductScanResult) => {
    const hasSignal =
      Boolean(result.name) ||
      Boolean(result.brand) ||
      Boolean(result.productType) ||
      Boolean(result.sizeUnit) ||
      Boolean(result.category) ||
      Boolean(result.nutritionNote) ||
      Boolean(result.storageZone) ||
      Boolean(result.storageBin) ||
      Boolean(result.image) ||
      Number(result.sizeOz) > 0 ||
      Number(result.quantity) > 0 ||
      Boolean(result.containerType);
    if (!hasSignal) return;
    const normalizedSizeUnit =
      typeof result.sizeUnit === 'string' ? result.sizeUnit.trim().toLowerCase() : '';
    const resolvedSizeUnit = SIZE_UNIT_OPTIONS.includes(
      normalizedSizeUnit as SizeUnit
    )
      ? (normalizedSizeUnit as SizeUnit)
      : undefined;
    const normalizedContainerType =
      typeof result.containerType === 'string'
        ? result.containerType.trim().toLowerCase()
        : '';
    const resolvedContainerType =
      normalizedContainerType === 'plastic' ||
      normalizedContainerType === 'glass' ||
      normalizedContainerType === 'aluminum'
        ? (normalizedContainerType as UpcContainerType)
        : undefined;
    const resolvedIsGlass =
      resolvedContainerType !== undefined
        ? resolvedContainerType === 'glass'
        : undefined;
    setUpcDraft(prev => ({
      ...prev,
      name: result.name || prev.name,
      sizeOz: Number.isFinite(result.sizeOz) ? result.sizeOz : prev.sizeOz,
      sizeUnit: resolvedSizeUnit ?? prev.sizeUnit,
      isEligible: result.isEligible,
      containerType: resolvedContainerType ?? prev.containerType
    }));
    setNewProduct(prev => ({
      ...prev,
      name: result.name || prev.name,
      brand: result.brand || prev.brand,
      productType: result.productType || prev.productType,
      category: result.category || prev.category,
      nutritionNote: result.nutritionNote || prev.nutritionNote,
      storageZone: result.storageZone || prev.storageZone,
      storageBin: result.storageBin || prev.storageBin,
      image: result.image || prev.image,
      stock:
        Number.isFinite(result.quantity) && result.quantity > 0
          ? result.quantity
          : prev.stock,
      sizeOz: Number.isFinite(result.sizeOz) ? result.sizeOz : prev.sizeOz,
      sizeUnit: resolvedSizeUnit ?? prev.sizeUnit,
      isGlass: resolvedIsGlass ?? prev.isGlass
    }));
  };

  const runLabelScan = async (photo = labelScanPhoto, mime = labelScanMime) => {
    if (!scannedUpcForCreation) {
      setLabelScanError('Scan a product UPC first.');
      return;
    }
    if (!photo) {
      setLabelScanError('Capture a label photo in the scanner.');
      return;
    }
    if (typeof photo !== 'string' || !photo.startsWith('data:image/')) {
      console.error('Invalid photo data for label scan.', { photo });
      setLabelScanError(INVALID_PHOTO_MESSAGE);
      return;
    }
    if (!isValidPhotoDataUrl(photo)) {
      console.error('Invalid photo data for label scan.', { photo });
      setLabelScanError(INVALID_PHOTO_MESSAGE);
      return;
    }

    setIsLabelScanning(true);
    setLabelScanError(null);
    const result = await analyzeProductScan(
      photo,
      scannedUpcForCreation,
      typeof mime === 'string' ? mime : undefined
    );
    setLabelScanResult(result);
    applyLabelScanToDrafts(result);
    if (result.message && !result.name) {
      setLabelScanError(result.message);
    }
    setIsLabelScanning(false);
  };

  // ---- Inventory API ----
  const resetCreateForm = useCallback(() => {
    setNewProduct({ ...DEFAULT_NEW_PRODUCT });
    setScannedUpcForCreation('');
    setLabelScanPhoto(null);
    setLabelScanMime(null);
    setLabelScanResult(null);
    setLabelScanError(null);
    setCreateError(null);
  }, []);

  const handleCancelCreate = useCallback(() => {
    resetCreateForm();
    setScannerMode(ScannerMode.INVENTORY_CREATE);
    setScannerModalOpen(!isInlineInventoryScanner);
  }, [isInlineInventoryScanner, resetCreateForm]);

  const apiCreateProduct = async () => {
    setCreateError(null);
    setIsCreating(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newProduct.name.trim(),
          price: Number(newProduct.price),
          deposit: upcDraft.isEligible ? 0.10 : 0.00,
          stock: Number(newProduct.stock),
          sizeOz: Number(newProduct.sizeOz),
          sizeUnit: newProduct.sizeUnit,
          category: newProduct.category,
          brand: newProduct.brand,
          productType: newProduct.productType,
          nutritionNote: newProduct.nutritionNote,
          storageZone: newProduct.storageZone,
          storageBin: newProduct.storageBin,
          image: newProduct.image,
          isGlass: !!newProduct.isGlass
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Create failed');

      const created: Product = {
        ...data.product,
        sizeUnit: data.product?.sizeUnit || newProduct.sizeUnit,
        nutritionNote: data.product?.nutritionNote || newProduct.nutritionNote
      };
      setProducts(prev => [created, ...prev]);

      // Link UPC to SKU if scanned
      if (scannedUpcForCreation) {
        try {
          await fetch(`${BACKEND_URL}/api/upc/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ upc: scannedUpcForCreation, productId: created.id })
          });

          const canWriteRegistry = activeModule === 'inventory' && scannerMode === ScannerMode.INVENTORY_CREATE;
          if (canWriteRegistry) {
            const sizeOz = Number.isFinite(Number(newProduct.sizeOz))
              ? Number(newProduct.sizeOz)
              : Number(upcDraft.sizeOz || 0);
            const sizeUnit = newProduct.sizeUnit || upcDraft.sizeUnit;
            const registryPayload = {
              upc: scannedUpcForCreation,
              name: upcDraft.name || newProduct.name.trim(),
              brand: newProduct.brand,
              productType: newProduct.productType,
              depositValue: upcDraft.isEligible ? 0.1 : 0,
              price: Number(newProduct.price),
              sizeOz,
              sizeUnit,
              isEligible: upcDraft.isEligible,
              containerType: upcDraft.containerType
            };
            const registryExists = upcItemsRef.current.some(item => item.upc === scannedUpcForCreation);

            if (!registryExists) {
              const registryRes = await fetch(`${BACKEND_URL}/api/upc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(registryPayload)
              });
              if (!registryRes.ok && registryRes.status !== 409) {
                const registryData = await registryRes.json().catch(() => ({}));
                throw new Error(registryData?.error || 'Failed to create UPC registry entry');
              }
            }

            // Update UPC metadata
            await fetch(`${BACKEND_URL}/api/upc/${scannedUpcForCreation}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                name: registryPayload.name,
                brand: registryPayload.brand,
                productType: registryPayload.productType,
                sizeOz: registryPayload.sizeOz,
                sizeUnit: registryPayload.sizeUnit,
                isEligible: registryPayload.isEligible,
                containerType: registryPayload.containerType
              })
            });
          }
        } catch (linkError) {
          console.error('Failed to link UPC:', linkError);
          // Don't fail the whole creation
        }
      }

      resetCreateForm();
      setScannerMode(ScannerMode.INVENTORY_CREATE);
      setScannerModalOpen(!isInlineInventoryScanner);
      return created;
    } catch (e: any) {
      setCreateError(e?.message || 'Create failed');
      return null;
    } finally {
      setIsCreating(false);
    }
  };

  // Load audit counts when location changes
  useEffect(() => {
    if (selectedLocation && auditId) {
      fetch(`${BACKEND_URL}/api/inventory-audit?auditId=${auditId}&location=${selectedLocation}`, {
        credentials: 'include'
      })
        .then(res => res.json())
        .then(data => setAuditCounts(data.counts || {}))
        .catch(() => setAuditCounts({}));
    } else {
      setAuditCounts({});
    }
  }, [selectedLocation, auditId]);

  const handleAuditScan = async (upc: string, qty = 1) => {
    const data = await apiScanUpc(upc, qty, true); 

    if (data && data.product) {
      const product = data.product;
      const newCount = (auditCounts[product.id] || 0) + qty;
      setAuditCounts(prev => ({ ...prev, [product.id]: newCount }));
      // Save to backend
      try {
        await fetch(`${BACKEND_URL}/api/inventory-audit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ auditId, location: selectedLocation, productId: product.id, countedQuantity: newCount })
        });
      } catch (err) {
        console.error('Failed to save audit count');
      }
      setAuditUpcInput('');
      setAuditError(null);
    } else {
      setAuditError('Product not found for UPC');
    }
  };

  const handlePhotoCaptured = useCallback((photoDataUrl: unknown, mime: unknown) => {
    if (typeof photoDataUrl !== 'string' || !photoDataUrl.startsWith('data:image/')) {
      console.error('Invalid photo data captured from scanner.', { photoDataUrl });
      setLabelScanError(INVALID_PHOTO_MESSAGE);
      return;
    }
    if (!isValidPhotoDataUrl(photoDataUrl)) {
      console.error('Invalid photo data captured from scanner.', { photoDataUrl });
      setLabelScanError(INVALID_PHOTO_MESSAGE);
      return;
    }
    setLabelScanPhoto(photoDataUrl);
    setLabelScanMime(typeof mime === 'string' ? mime : null);
    void runLabelScan(photoDataUrl, typeof mime === 'string' ? mime : undefined);
    setScannerModalOpen(false);
  }, [runLabelScan, setScannerModalOpen]);

  const handleScannerScan = useCallback(async (upc: string) => {
    if (scannerMode === ScannerMode.INVENTORY_CREATE) {
      // Normalize: digits only
      const normalized = String(upc).replace(/\D/g, '').trim();
      if (!normalized) return;

      // Set authoritative creation UPC
      setScannedUpcForCreation(normalized);
      upcLastScannedRef.current = normalized;

      // Keep existing fields in sync for registry/inventory UI
      setUpcInput(normalized);
      setUpcDraft(prev => ({ ...prev, upc: normalized }));

      // Photo is captured manually via button
      const labelScanFlags = {
        name: Boolean(labelScanResult?.name),
        brand: Boolean(labelScanResult?.brand),
        productType: Boolean(labelScanResult?.productType),
        nutritionNote: Boolean(labelScanResult?.nutritionNote),
        storageZone: Boolean(labelScanResult?.storageZone),
        storageBin: Boolean(labelScanResult?.storageBin),
        image: Boolean(labelScanResult?.image),
        sizeOz: Number(labelScanResult?.sizeOz || 0) > 0,
        quantity: Number(labelScanResult?.quantity || 0) > 0,
        containerType: Boolean(labelScanResult?.containerType),
        isEligible: typeof labelScanResult?.isEligible === 'boolean'
      };

      const shouldFillText = (current: string, next?: string, locked = false) => {
        if (locked) return current;
        const trimmed = current.trim();
        if (trimmed) return current;
        return next ? next : current;
      };

      const shouldFillNumber = (current: number, next?: number, locked = false) => {
        if (locked) return current;
        if (Number.isFinite(current) && current > 0) return current;
        if (Number.isFinite(next) && Number(next) > 0) return Number(next);
        return current;
      };

      const applyLookupDrafts = (
        lookupData: {
          name?: string;
          price?: number;
          sizeOz?: number;
          containerType?: UpcContainerType;
          isEligible?: boolean;
          depositValue?: number;
        },
        productData?: Partial<Product>
      ) => {
        setUpcDraft(prev => ({
          ...prev,
          name: shouldFillText(prev.name, lookupData.name, labelScanFlags.name),
          price: shouldFillNumber(prev.price, lookupData.price, false),
          sizeOz: shouldFillNumber(prev.sizeOz, lookupData.sizeOz, labelScanFlags.sizeOz),
          containerType: labelScanFlags.containerType
            ? prev.containerType
            : lookupData.containerType || prev.containerType,
          isEligible: labelScanFlags.isEligible
            ? prev.isEligible
            : lookupData.isEligible ?? prev.isEligible,
          depositValue:
            Number.isFinite(prev.depositValue) && prev.depositValue > 0
              ? prev.depositValue
              : Number.isFinite(lookupData.depositValue)
              ? Number(lookupData.depositValue)
              : prev.depositValue
        }));

        if (!productData && !lookupData) return;

        setNewProduct(prev => {
          const resolvedContainerType = lookupData.containerType;
          const resolvedIsGlass =
            resolvedContainerType === 'glass' ? true : resolvedContainerType ? false : undefined;
          return {
            ...prev,
            name: shouldFillText(
              prev.name,
              productData?.name || lookupData.name,
              labelScanFlags.name
            ),
            brand: shouldFillText(prev.brand, productData?.brand, labelScanFlags.brand),
            productType: shouldFillText(
              prev.productType,
              productData?.productType,
              labelScanFlags.productType
            ),
            nutritionNote: shouldFillText(
              prev.nutritionNote,
              productData?.nutritionNote,
              labelScanFlags.nutritionNote
            ),
            storageZone: shouldFillText(
              prev.storageZone,
              productData?.storageZone,
              labelScanFlags.storageZone
            ),
            storageBin: shouldFillText(
              prev.storageBin,
              productData?.storageBin,
              labelScanFlags.storageBin
            ),
            image: shouldFillText(prev.image, productData?.image, labelScanFlags.image),
            stock: shouldFillNumber(
              prev.stock,
              productData?.stock,
              labelScanFlags.quantity
            ),
            price: shouldFillNumber(prev.price, productData?.price, false),
            sizeOz: shouldFillNumber(
              prev.sizeOz,
              productData?.sizeOz || lookupData.sizeOz,
              labelScanFlags.sizeOz
            ),
            isGlass:
              resolvedIsGlass === undefined || labelScanFlags.containerType
                ? prev.isGlass
                : prev.isGlass || resolvedIsGlass
          };
        });
      };

      try {
        const scanRes = await fetch(`${BACKEND_URL}/api/upc/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ upc: normalized, qty: 1, resolveOnly: true })
        });
        const scanData = await scanRes.json().catch(() => ({}));
        if (!scanRes.ok) throw new Error(scanData?.error || 'UPC lookup failed');

        if (upcLastScannedRef.current !== normalized) return;

        const upcEntry = scanData?.upcEntry;
        const resolvedProduct = scanData?.product;
        const mappedLookup = upcEntry
          ? {
              name: upcEntry?.name,
              price: Number(upcEntry?.price || 0),
              sizeOz: Number(upcEntry?.sizeOz || 0),
              containerType: upcEntry?.containerType,
              isEligible: upcEntry?.isEligible !== false,
              depositValue: Number(upcEntry?.depositValue || 0)
            }
          : undefined;

        if (mappedLookup || resolvedProduct) {
          applyLookupDrafts(mappedLookup || {}, resolvedProduct || undefined);
          return;
        }

        const eligibilityRes = await fetch(
          `${BACKEND_URL}/api/upc/eligibility?upc=${encodeURIComponent(normalized)}`
        );
        if (!eligibilityRes.ok) return;
        const eligibilityData = await eligibilityRes.json().catch(() => ({}));
        if (upcLastScannedRef.current !== normalized) return;

        applyLookupDrafts({
          name: eligibilityData?.name,
          price: Number(eligibilityData?.price || 0),
          sizeOz: Number(eligibilityData?.sizeOz || 0),
          containerType: eligibilityData?.containerType,
          isEligible: eligibilityData?.eligible !== false,
          depositValue: Number(eligibilityData?.depositValue || 0)
        });
      } catch (err) {
        console.error('UPC lookup failed:', err);
      }

      return;
    }
    if (scannerMode === ScannerMode.UPC_LOOKUP) {
      setUpcInput(upc);
      handleUpcLookup(upc);
      // Keep modal open for UPC_LOOKUP mode
    }
  }, [
    scannerMode,
    labelScanResult,
    setScannedUpcForCreation,
    setUpcInput,
    setUpcDraft,
    setNewProduct,
    handleUpcLookup
  ]);

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
      // Clean up local state
      setUserDrafts(prev => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setUserLedgers(prev => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    } catch (e: any) {
      alert(e?.message || 'Failed to delete user');
    }
  };

  const runAudit = async () => {
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

  const modules = [
    { id: 'analytics', label: 'Dashboard', icon: BarChart3 },
    { id: 'orders', label: 'Orders', icon: Truck },
    { id: 'reviews', label: 'Reviews', icon: ShieldCheck },
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'upc', label: 'UPC Registry', icon: ScanLine },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'logs', label: 'Audit Logs', icon: Terminal },
    { id: 'settings', label: 'Settings', icon: Sliders }
  ];

  return (
    <div className="overflow-visible md:overflow-y-auto md:h-[calc(100vh-12rem)]">
      <div className="flex flex-col md:flex-row gap-12 animate-in fade-in">
      <nav className="md:hidden -mx-4 px-4">
        <div className="flex gap-2 overflow-x-auto whitespace-nowrap pb-2">
          {modules.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => handleModuleSelect(m.id)}
              className={`shrink-0 text-left px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-3 ${
                activeModule === m.id
                  ? 'bg-ninpo-lime text-ninpo-black shadow-neon'
                  : 'hover:bg-white/5 text-slate-500'
              }`}
            >
              <m.icon className="w-4 h-4" /> {m.label}
            </button>
          ))}
        </div>
      </nav>

      <aside className="hidden md:block w-full md:w-72 space-y-2 md:sticky md:top-6 md:self-start md:shrink-0">
        {modules.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => handleModuleSelect(m.id)}
            className={`w-full text-left p-5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-4 ${
              activeModule === m.id
                ? 'bg-ninpo-lime text-ninpo-black shadow-neon'
                : 'hover:bg-white/5 text-slate-500'
            }`}
          >
            <m.icon className="w-5 h-5" /> {m.label}
          </button>
        ))}
      </aside>

      <div className="flex-1 w-full space-y-8 pb-32">
        {activeModule === 'analytics' && (
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
            runAudit={runAudit}
            runOpsSummary={runOpsSummary}
          />
        )}
        {activeModule === 'orders' && (
          <ManagementOrders
            orders={orders}
            users={users}
            isRefreshingOrders={isRefreshingOrders}
            ordersError={ordersError}
            apiRefreshOrders={apiRefreshOrders}
            updateOrder={updateOrder}
            canCancel={canCancel}
          />
        )}
        {activeModule === 'users' && (
          <ManagementUsers
            users={users}
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
            fetchUsers={fetchUsers}
            handleUserDraftChange={handleUserDraftChange}
            fetchUserLedger={fetchUserLedger}
            requestUserStats={requestUserStats}
            toggleUserDetails={toggleUserDetails}
            saveUserDraft={saveUserDraft}
            apiDeleteUser={apiDeleteUser}
            allowPlatinumTier={allowPlatinumTier}
          />
        )}
        {activeModule === 'logs' && (
          <ManagementAuditLogs
            auditLogs={auditLogs}
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
          />
        )}
        {activeModule === 'inventory' && (
          <ManagementInventory
            products={products}
            setProducts={setProducts}
            inventoryMode={inventoryMode}
            setInventoryMode={setInventoryMode}
            selectedLocation={selectedLocation}
            setSelectedLocation={setSelectedLocation}
            auditId={auditId}
            auditCounts={auditCounts}
            auditUpcInput={auditUpcInput}
            setAuditUpcInput={setAuditUpcInput}
            auditError={auditError}
            handleAuditScan={handleAuditScan}
            scannerMode={scannerMode}
            setScannerMode={setScannerMode}
            scannerModalOpen={scannerModalOpen}
            setScannerModalOpen={setScannerModalOpen}
            scannedUpcForCreation={scannedUpcForCreation}
            setScannedUpcForCreation={setScannedUpcForCreation}
            upcDraft={upcDraft}
            setUpcDraft={setUpcDraft}
            labelScanPhoto={labelScanPhoto}
            setLabelScanPhoto={setLabelScanPhoto}
            labelScanMime={labelScanMime}
            setLabelScanMime={setLabelScanMime}
            labelScanResult={labelScanResult}
            setLabelScanResult={setLabelScanResult}
            labelScanError={labelScanError}
            setLabelScanError={setLabelScanError}
            isLabelScanning={isLabelScanning}
            setIsLabelScanning={setIsLabelScanning}
            newProduct={newProduct}
            setNewProduct={setNewProduct}
            createError={createError}
            setCreateError={setCreateError}
            isCreating={isCreating}
            setIsCreating={setIsCreating}
            apiCreateProduct={apiCreateProduct}
            startEditProduct={startEditProduct}
            apiRestockPlus10={apiRestockPlus10}
            apiDeleteProduct={apiDeleteProduct}
            editingProduct={editingProduct}
            setEditingProduct={setEditingProduct}
            editDraft={editDraft}
            setEditDraft={setEditDraft}
            editError={editError}
            setEditError={setEditError}
            isSavingEdit={isSavingEdit}
            setIsSavingEdit={setIsSavingEdit}
            apiUpdateProduct={apiUpdateProduct}
          />
        )}
        {activeModule === 'upc' && (
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
        )}
        {activeModule === 'settings' && (
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
        )}

        {/* =========================
            ORDERS LIST
        ========================= */}
        {activeModule === 'orders' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black uppercase text-white tracking-widest">
                  Orders Feed
                </h2>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
                  orderId • status • total • items • createdAt
                </p>
              </div>

              <button
                onClick={apiRefreshOrders}
                disabled={isRefreshingOrders}
                className="px-7 py-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 transition-all flex items-center gap-3"
              >
                {isRefreshingOrders ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <RefreshCw className="w-5 h-5" />
                )}
                Refresh Orders
              </button>
            </div>

            {ordersError && (
              <div className="bg-ninpo-card p-6 rounded-[2rem] border border-ninpo-red/20 text-[11px] text-ninpo-red">
                {ordersError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-6">
              {orders.length === 0 ? (
                <div className="p-20 bg-ninpo-card rounded-[3rem] border border-dashed border-white/10 flex flex-col items-center justify-center text-center">
                  <PackageX className="w-12 h-12 text-slate-800 mb-4" />
                  <p className="text-[10px] uppercase font-black text-slate-700 tracking-[0.4em]">
                    No Orders Found
                  </p>
                </div>
              ) : (
                orders.map(o => {
                  const estimatedGross = Number(
                    o.estimatedReturnCreditGross ?? o.estimatedReturnCredit ?? 0
                  );
                  const estimatedNet = Number(o.estimatedReturnCredit || 0);
                  const verifiedGross =
                    o.verifiedReturnCreditGross !== undefined
                      ? Number(o.verifiedReturnCreditGross || 0)
                      : undefined;
                  const verifiedNet =
                    o.verifiedReturnCredit !== undefined
                      ? Number(o.verifiedReturnCredit || 0)
                      : undefined;
                  const returnCounts = Array.isArray(o.returnUpcCounts) ? o.returnUpcCounts : [];
                  const verifiedCounts = Array.isArray(o.verifiedReturnUpcCounts)
                    ? o.verifiedReturnUpcCounts
                    : [];
                  const returnCountTotal = countTotalUpcs(returnCounts);
                  const verifiedCountTotal = countTotalUpcs(verifiedCounts);

                  return (
                    <div
                      key={o.id}
                      className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6"
                    >
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                      <div>
                        <p className="text-[10px] font-black text-slate-600 uppercase">
                          ORDER: {o.id}
                        </p>

                        <div className="flex flex-wrap items-center gap-3 mt-4">
                          <span className="px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest text-white/80 border-white/10 bg-white/5">
                            {fmtTime(o.createdAt)}
                          </span>

                          <span
                            className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest ${
                              o.status === OrderStatus.PAID
                                ? 'text-blue-400 border-blue-400/20 bg-blue-400/5'
                                : o.status === OrderStatus.AUTHORIZED
                                ? 'text-cyan-300 border-cyan-300/20 bg-cyan-300/5'
                                : o.status === OrderStatus.CLOSED
                                ? 'text-slate-400 border-slate-400/20 bg-slate-400/5'
                                : 'text-ninpo-lime border-ninpo-lime/20 bg-ninpo-lime/5'
                            }`}
                          >
                            {String(o.status).replace('_', ' ')}
                          </span>

                          {o.driverId && (
                            <span className="px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest text-white/70 border-white/10 bg-white/5">
                              DRIVER: {o.driverId}
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] text-slate-500 mt-4">
                          CustomerId:{' '}
                          <span className="text-slate-300 font-bold">{o.customerId}</span>
                        </p>

                        {o.address && (
                          <p className="text-[11px] text-slate-500 mt-1">
                            Address: <span className="text-slate-300 font-bold">{o.address}</span>
                          </p>
                        )}
                      </div>

                      {/* UPDATED HEADER RIGHT-SIDE */}
                      <div className="md:text-right space-y-2">
                        <p className="text-white font-black text-2xl tracking-tighter">
                          ${Number(o.total || 0).toFixed(2)}
                        </p>

                        <p className="text-[10px] font-bold text-slate-700 uppercase">
                          {o.items.length} LINE ITEMS
                        </p>

                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600 space-y-1">
                          <div className="flex items-center justify-between md:justify-end md:gap-3">
                            {/* See GLOSSARY.md for Route Fee definition */}
                            <span className="md:hidden">Route Fee:</span>
                            <span className="text-slate-300">
                              Route Fee: ${Number(o.routeFee || o.deliveryFee || 0).toFixed(2)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between md:justify-end md:gap-3">
                            <span className="md:hidden">Est Credit:</span>
                            <span className="text-slate-300">
                              Est Credit: ${estimatedNet.toFixed(2)}
                              {estimatedGross !== estimatedNet
                                ? ` (gross $${estimatedGross.toFixed(2)})`
                                : ''}
                            </span>
                          </div>

                          <div className="flex items-center justify-between md:justify-end md:gap-3">
                            <span className="md:hidden">Verified:</span>
                            <span className="text-slate-300">
                              Verified:{' '}
                              {verifiedNet === undefined
                                ? '—'
                                : `$${verifiedNet.toFixed(2)}`}
                              {verifiedNet !== undefined &&
                              verifiedGross !== undefined &&
                              verifiedGross !== verifiedNet
                                ? ` (gross $${verifiedGross.toFixed(2)})`
                                : ''}
                            </span>
                          </div>

                          <div className="flex items-center justify-between md:justify-end md:gap-3">
                            <span className="md:hidden">Final Charged:</span>
                            <span className="text-slate-300">
                              Final Charged:{' '}
                              {o.capturedAmount === undefined
                                ? 'Not captured'
                                : o.capturedAmount === 0
                                ? '$0.00 (voided)'
                                : `$${Number(o.capturedAmount || 0).toFixed(2)}`}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-white/5 pt-6 space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                        Items
                      </p>

                      <div className="space-y-2">
                        {o.items.map((it, idx) => (
                          <div
                            key={`${o.id}-${idx}`}
                            className="flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl px-5 py-4"
                          >
                            <span className="text-[11px] text-slate-200 font-bold">
                              {it.productId}
                            </span>
                            <span className="text-[11px] text-slate-500 font-black">
                              x{it.quantity}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border-t border-white/5 pt-6 space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                        Return UPCs
                      </p>
                      <div className="flex flex-col md:flex-row gap-6">
                        <div className="flex-1 space-y-3">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Submitted: <span className="text-slate-200">{returnCountTotal}</span>
                          </div>
                          {returnCounts.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {returnCounts.map(entry => (
                                <span
                                  key={`return-${o.id}-${entry.upc}`}
                                  className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[10px] font-bold text-slate-200"
                                >
                                  {entry.upc} × {entry.quantity}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] uppercase tracking-widest text-slate-500">
                              No return UPCs.
                            </p>
                          )}
                        </div>
                        <div className="flex-1 space-y-3">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Verified: <span className="text-slate-200">{verifiedCountTotal}</span>
                          </div>
                          {verifiedCounts.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {verifiedCounts.map(entry => (
                                <span
                                  key={`verified-${o.id}-${entry.upc}`}
                                  className="px-3 py-2 rounded-xl bg-ninpo-lime/10 border border-ninpo-lime/20 text-[10px] font-bold text-ninpo-lime"
                                >
                                  {entry.upc} × {entry.quantity}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] uppercase tracking-widest text-slate-500">
                              No verified UPCs.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ACTIONS */}
                    <div className="flex flex-col md:flex-row gap-4 border-t border-white/5 pt-6">
                      {/* Assign to Me (owner-as-driver) */}
                      {(o.status === OrderStatus.PENDING ||
                        o.status === OrderStatus.AUTHORIZED ||
                        o.status === OrderStatus.PAID) && (
                        <button
                          onClick={() =>
                            handleLogisticsUpdate(o.id, OrderStatus.ASSIGNED, {
                              driverId: users?.username || users?.id || 'OWNER'
                            })
                          }
                          className="flex-1 py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all shadow-neon"
                        >
                          <UserCheck className="w-5 h-5" /> Assign to Me
                        </button>
                      )}

                      {/* Progress buttons */}
                      {o.status === OrderStatus.ASSIGNED && (
                        <button
                          onClick={() => handleLogisticsUpdate(o.id, OrderStatus.PICKED_UP)}
                          className="flex-1 py-5 bg-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all"
                        >
                          <PackageCheck className="w-5 h-5" /> Mark Picked Up
                        </button>
                      )}

                      {o.status === OrderStatus.PICKED_UP && (
                        <button
                          onClick={() => handleLogisticsUpdate(o.id, OrderStatus.ARRIVING)}
                          className="flex-1 py-5 bg-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all"
                        >
                          <Navigation2 className="w-5 h-5" /> Mark Arriving
                        </button>
                      )}

                      {o.status === OrderStatus.ARRIVING && (
                        <button
                          onClick={() => handleLogisticsUpdate(o.id, OrderStatus.DELIVERED)}
                          className="flex-1 py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all shadow-neon"
                        >
                          <CheckCircle2 className="w-5 h-5" /> Mark Delivered
                        </button>
                      )}

                      {/* Cancel (immediate restock on backend) */}
                      {canCancel(o) && (
                        <button
                          onClick={() => handleLogisticsUpdate(o.id, OrderStatus.CLOSED)}
                          className="md:w-[240px] py-5 bg-ninpo-red/10 text-ninpo-red rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 border border-ninpo-red/20 hover:bg-ninpo-red/20 transition-all"
                        >
                          <XCircle className="w-5 h-5" /> Cancel (Restock)
                        </button>
                      )}
                    </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* =========================
            REVIEWS
        ========================= */}
        {activeModule === 'reviews' && (
          <div className="space-y-6">
            <h2 className="text-xl font-black uppercase text-white tracking-widest">
              Auth Hub Reviews
            </h2>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                {(['PENDING', 'APPROVED', 'REJECTED'] as ApprovalRequest['status'][]).map(
                  status => (
                    <button
                      key={status}
                      onClick={() => setApprovalFilter(status)}
                      className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                        approvalFilter === status
                          ? 'bg-white text-ninpo-black border-white'
                          : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
                      }`}
                    >
                      {status.toLowerCase()}
                    </button>
                  )
                )}
              </div>

              {filteredApprovals.length === 0 ? (
                <div className="p-20 bg-ninpo-card rounded-[3rem] border border-dashed border-white/10 flex flex-col items-center justify-center text-center">
                  <ShieldCheck className="w-12 h-12 text-slate-800 mb-4" />
                  <p className="text-[10px] uppercase font-black text-slate-700 tracking-[0.4em]">
                    Queue Cleared
                  </p>
                </div>
              ) : (
                filteredApprovals.map(a => (
                  <div
                    key={a.id}
                    className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4 transition-all hover:border-white/10 cursor-pointer"
                    onClick={() => setSelectedApproval(a)}
                  >
                    <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                      <div className="flex items-center gap-6">
                        {a.photoProof && (
                          <div
                            className="relative group cursor-pointer"
                            onClick={event => {
                              event.stopPropagation();
                              setPreviewPhoto(a.photoProof!);
                            }}
                          >
                            <img
                              src={a.photoProof}
                              alt="Proof"
                              className="w-24 h-24 rounded-2xl object-cover border border-white/10"
                            />
                          </div>
                        )}

                        <div>
                          <p className="text-white font-black uppercase tracking-widest text-[11px]">
                            {a.type}
                          </p>
                          <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-widest">
                            USER: {a.userId} • AMOUNT: ${a.amount.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-widest">
                            ORDER: {a.orderId || 'N/A'} • REQUESTED: {fmtTime(a.createdAt)}
                          </p>
                          <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-widest">
                            REASON: {a.reason || '—'}
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={event => {
                            event.stopPropagation();
                            handleApprove(a);
                          }}
                          className="px-6 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest"
                        >
                          Approve
                        </button>
                        <button
                          onClick={event => {
                            event.stopPropagation();
                            handleReject(a.id);
                          }}
                          className="px-6 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* =========================
            USERS
        ========================= */}
        {activeModule === 'users' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black uppercase text-white tracking-widest">
                  Users
                </h2>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
                  accounts • loyalty • credits • tier
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                <input
                  value={userFilter}
                  onChange={e => setUserFilter(e.target.value)}
                  placeholder="Filter by username, tier, role..."
                  className="flex-1 md:w-64 bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-[11px] text-white"
                />
                <button
                  onClick={() => {
                    setIsUsersLoading(true);
                    setUsersError(null);
                    fetchUsers()
                      .catch((e: any) => setUsersError(e?.message || 'Failed to load users'))
                      .finally(() => setIsUsersLoading(false));
                  }}
                  className="px-6 py-3 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 transition-all flex items-center justify-center gap-3"
                >
                  {isUsersLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  Refresh
                </button>
              </div>
            </div>

            {usersError && (
              <div className="bg-ninpo-card p-6 rounded-[2rem] border border-ninpo-red/20 text-[11px] text-ninpo-red">
                {usersError}
              </div>
            )}

            {isUsersLoading && users.length === 0 ? (
              <div className="p-12 bg-ninpo-card rounded-[2.5rem] border border-white/5 text-center text-[10px] text-slate-500 uppercase tracking-widest">
                Loading users...
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-20 bg-ninpo-card rounded-[3rem] border border-dashed border-white/10 flex flex-col items-center justify-center text-center">
                <Users className="w-12 h-12 text-slate-800 mb-4" />
                <p className="text-[10px] uppercase font-black text-slate-700 tracking-[0.4em]">
                  No Users Found
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {filteredUsers.map(u => {
                  const stats = userStats[u.id];
                  const draft = userDrafts[u.id] || {};
                  const isExpanded = expandedUserId === u.id;
                  const ledgerEntries = userLedgers[u.id] || [];
                  const ledgerBusy = ledgerLoading[u.id];
                  const ledgerError = ledgerErrors[u.id];
                  const statsLoading = userStatsLoading[u.id];
                  const tierKey = (u.membershipTier || 'COMMON').toString().toUpperCase();
                  const tierLabel =
                    tierKey === 'NONE'
                      ? 'COMMON'
                      : tierKey === 'PLATINUM'
                      ? 'SECRET PLATINUM'
                      : tierKey;
                  const showSignupBonus = isNewSignupWithBonus(u);
                  const orderCountLabel = statsLoading
                    ? '...'
                    : stats
                    ? stats.orderCount
                    : '—';
                  const totalSpendLabel = statsLoading
                    ? 'Loading...'
                    : stats
                    ? `$${Number(stats.totalSpend || 0).toFixed(2)}`
                    : '—';
                  const lastOrderLabel = statsLoading
                    ? 'Loading...'
                    : stats?.lastOrderAt
                    ? fmtTime(stats.lastOrderAt)
                    : '—';

                  return (
                    <div
                      key={u.id}
                      className="group bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4 transition-all hover:border-white/10"
                      onClick={() => toggleUserDetails(u)}
                    >
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 flex flex-wrap items-center gap-2">
                            <span>USER: {u.username || u.name || u.id}</span>
                            <span
                              className={`px-2.5 py-1 rounded-full border text-[9px] font-black uppercase tracking-[0.3em] ${getTierStyles(
                                tierKey === 'NONE' ? 'COMMON' : tierKey
                              )}`}
                            >
                              {tierLabel}
                            </span>
                          </p>
                          <p className="text-white font-black text-lg uppercase mt-1">
                            {tierLabel} STATUS
                          </p>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-2">
                            Role: {u.role || 'CUSTOMER'}
                          </p>
                          {showSignupBonus && (
                            <p className="text-[10px] text-ninpo-lime font-bold uppercase tracking-widest mt-2">
                              Signup bonus awarded
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-3">
                          <div className="px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest text-white/80 border-white/10 bg-white/5">
                            Credits: ${Number(u.creditBalance || 0).toFixed(2)}
                          </div>
                          <div className="px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest text-white/80 border-white/10 bg-white/5">
                            Points: {Number(u.loyaltyPoints || 0)}
                          </div>
                          <div className="px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest text-white/80 border-white/10 bg-white/5">
                            Orders: {orderCountLabel}
                          </div>
                        </div>
                      </div>

                      <div
                        className={`overflow-hidden transition-all duration-300 ${
                          isExpanded
                            ? 'max-h-[520px] opacity-100'
                            : 'max-h-0 opacity-0 group-hover:max-h-[520px] group-hover:opacity-100'
                        }`}
                      >
                        <div className="border-t border-white/5 pt-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
                          <div className="space-y-4">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                              Summary
                            </p>
                            <div className="space-y-2 text-[11px] text-slate-400">
                              <p>
                                Total Spend:{' '}
                                <span className="text-slate-200 font-bold">{totalSpendLabel}</span>
                              </p>
                              <p>
                                Last Order:{' '}
                                <span className="text-slate-200 font-bold">{lastOrderLabel}</span>
                              </p>
                              <p>
                                Joined:{' '}
                                <span className="text-slate-200 font-bold">
                                  {fmtTime(u.createdAt)}
                                </span>
                              </p>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                              Manage
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <input
                                type="number"
                                className="bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-[11px] text-white"
                                placeholder="Credits"
                                value={draft.creditBalance ?? u.creditBalance ?? 0}
                                onClick={e => e.stopPropagation()}
                                onChange={e =>
                                  handleUserDraftChange(u.id, {
                                    creditBalance: Number(e.target.value)
                                  })
                                }
                              />
                              <input
                                type="number"
                                className="bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-[11px] text-white"
                                placeholder="Points"
                                value={draft.loyaltyPoints ?? u.loyaltyPoints ?? 0}
                                onClick={e => e.stopPropagation()}
                                onChange={e =>
                                  handleUserDraftChange(u.id, {
                                    loyaltyPoints: Number(e.target.value)
                                  })
                                }
                              />
                              <select
                                className="bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-[11px] text-white"
                                value={(draft.membershipTier ?? u.membershipTier ?? 'COMMON').toString()}
                                onClick={e => e.stopPropagation()}
                                disabled={!allowPlatinumTier && u.membershipTier === 'PLATINUM'}
                                onChange={e =>
                                  handleUserDraftChange(u.id, {
                                    membershipTier: e.target.value as any
                                  })
                                }
                              >
                                <option value="COMMON">Common</option>
                                <option value="BRONZE">Bronze</option>
                                <option value="SILVER">Silver</option>
                                <option value="GOLD">Gold</option>
                                {(allowPlatinumTier || u.membershipTier === 'PLATINUM') && (
                                  <option value="PLATINUM" disabled={!allowPlatinumTier}>
                                    Secret Platinum
                                  </option>
                                )}
                              </select>
                            </div>

                            <div className="flex flex-wrap gap-3">
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  saveUserDraft(u.id);
                                }}
                                className="px-6 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest"
                              >
                                Save
                              </button>
                              {u.role !== 'OWNER' && u.id !== user?.id && (
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    apiDeleteUser(u.id);
                                  }}
                                  className="px-6 py-3 rounded-2xl bg-ninpo-red text-white text-[10px] font-black uppercase tracking-widest"
                                >
                                  Delete
                                </button>
                              )}
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  setExpandedUserId(prev => (prev === u.id ? null : u.id));
                                }}
                                className="px-6 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                              >
                                {isExpanded ? 'Collapse' : 'Pin Details'}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                                Ledger
                              </p>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  fetchUserLedger(u.id);
                                }}
                                className="px-3 py-1 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase tracking-widest text-white/70 hover:text-white"
                              >
                                Refresh
                              </button>
                            </div>

                            {ledgerError && (
                              <div className="text-[10px] text-ninpo-red">{ledgerError}</div>
                            )}

                            {ledgerBusy ? (
                              <div className="text-[10px] text-slate-500 uppercase tracking-widest">
                                Loading ledger...
                              </div>
                            ) : ledgerEntries.length === 0 ? (
                              <div className="text-[10px] text-slate-500 uppercase tracking-widest">
                                No ledger entries yet.
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-44 overflow-auto pr-1">
                                {ledgerEntries.map(entry => (
                                  <div
                                    key={entry.id}
                                    className="border border-white/5 rounded-2xl px-3 py-2 bg-black/30"
                                  >
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="text-slate-200 font-bold">
                                        {entry.reason || 'UPDATE'}
                                      </span>
                                      <span
                                        className={
                                          Number(entry.delta || 0) >= 0
                                            ? 'text-ninpo-lime font-bold'
                                            : 'text-ninpo-red font-bold'
                                        }
                                      >
                                        {fmtDelta(entry.delta)}
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-slate-500">
                                      {fmtTime(entry.createdAt)}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* =========================
            AUDIT LOGS
        ========================= */}
        {activeModule === 'logs' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-xl font-black uppercase text-white tracking-widest">
                  Audit Logs
                </h2>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
                  type • actorId • details • createdAt
                </p>
              </div>

              <button
                onClick={handleDownloadAuditCsv}
                disabled={filteredAuditLogs.length === 0}
                className="px-7 py-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Download CSV
              </button>
            </div>

            <div className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Type
                  </label>
                  <select
                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-[11px] text-white"
                    value={auditTypeFilter}
                    onChange={e =>
                      setAuditTypeFilter(e.target.value as 'ALL' | AuditLogType)
                    }
                  >
                    {auditTypeOptions.map(option => (
                      <option key={option} value={option}>
                        {option.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Actor
                  </label>
                  <input
                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-[11px] text-white"
                    placeholder="Filter by actorId"
                    value={auditActorFilter}
                    onChange={e => setAuditActorFilter(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Time Range
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(['24h', '7d', '30d'] as const).map(range => (
                      <button
                        key={range}
                        onClick={() => setAuditRangeFilter(range)}
                        className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                          auditRangeFilter === range
                            ? 'bg-white text-ninpo-black border-white'
                            : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
                        }`}
                      >
                        {range}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-ninpo-card rounded-[2.5rem] border border-white/5 overflow-hidden">
              <div className="grid grid-cols-4 gap-4 px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-600 border-b border-white/5">
                <span>Type</span>
                <span>Actor</span>
                <span>Details</span>
                <span>Created</span>
              </div>

              {isAuditLogsLoading ? (
                <div className="p-16 text-center text-[10px] uppercase tracking-widest text-slate-600">
                  Loading audit logs...
                </div>
              ) : auditLogsError ? (
                <div className="p-6 text-center text-[10px] uppercase tracking-widest text-ninpo-red">
                  {auditLogsError}
                </div>
              ) : filteredAuditLogs.length === 0 ? (
                <div className="p-16 text-center text-[10px] uppercase tracking-widest text-slate-600">
                  No audit logs match your filters.
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {filteredAuditLogs.map(log => (
                    <div
                      key={log.id}
                      className="grid grid-cols-1 md:grid-cols-4 gap-3 px-6 py-4 text-[11px] text-slate-300"
                    >
                      <span className="font-bold text-white/80">{log.type}</span>
                      <span className="text-white/70">{log.actorId}</span>
                      <span className="text-slate-400">{log.details}</span>
                      <span className="text-slate-500">{fmtTime(log.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* =========================
            RETURN REVIEWS
        ========================= */}
        {activeModule === 'reviews' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-black uppercase text-white tracking-widest">
                Return Reviews
              </h2>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
                Review driver-submitted container verifications and approve settlements.
              </p>
            </div>

            <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                Pending Verifications
              </p>

              {isReturnVerificationsLoading ? (
                <div className="text-center py-8">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Loading verifications...</p>
                </div>
              ) : returnVerificationsError ? (
                <div className="bg-ninpo-red/10 border border-ninpo-red/20 rounded-2xl p-4 text-[11px] text-ninpo-red">
                  {returnVerificationsError}
                </div>
              ) : returnVerifications.length === 0 ? (
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  No pending verifications to review.
                </p>
              ) : (
                <div className="space-y-4">
                  {returnVerifications.map(verification => (
                    <div key={verification.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-white">
                            Order {verification.orderId}
                          </p>
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest">
                            Driver: {verification.driverId} • Customer: {verification.customerId}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            {new Date(verification.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                          <p className="text-[9px] uppercase tracking-widest text-slate-500">Recognized</p>
                          <p className="text-lg font-black text-ninpo-lime">{verification.recognizedCount}</p>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                          <p className="text-[9px] uppercase tracking-widest text-slate-500">Unrecognized</p>
                          <p className="text-lg font-black text-yellow-400">{verification.unrecognizedCount}</p>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                          <p className="text-[9px] uppercase tracking-widest text-slate-500">Total Scanned</p>
                          <p className="text-lg font-black text-white">{verification.totalCount}</p>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={() => settleReturnVerification(verification.id, verification.recognizedCount, verification.recognizedCount * 0.10, 0)}
                          disabled={settlingVerificationId === verification.id}
                          className="flex-1 px-4 py-3 bg-ninpo-lime text-ninpo-black rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                        >
                          {settlingVerificationId === verification.id ? 'Processing...' : 'Approve All Recognized'}
                        </button>
                        <button
                          onClick={() => settleReturnVerification(verification.id, 0, 0, 0)}
                          disabled={settlingVerificationId === verification.id}
                          className="px-4 py-3 bg-ninpo-red/10 text-ninpo-red rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                        >
                          Reject All
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* =========================
            SETTINGS
        ========================= */}
        {activeModule === 'settings' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-black uppercase text-white tracking-widest">
                Settings
              </h2>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
                Manage returns, checkout, and membership rules.
              </p>
            </div>

            {settingsError && (
              <div className="bg-ninpo-card p-4 rounded-2xl border border-ninpo-red/20 text-[11px] text-ninpo-red">
                {settingsError}
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
              <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5 space-y-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Returns Rules
                </p>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-ninpo-lime"
                      checked={settingsDraft.requirePhotoForRefunds}
                      onChange={e =>
                        updateSettingsDraft({
                          requirePhotoForRefunds: e.target.checked
                        })
                      }
                    />
                    Require photo for refunds
                  </label>
                </div>
              </div>

              <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5 space-y-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Fees
                </p>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Route Fee
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      step="0.01"
                      value={settingsDraft.routeFee}
                      onChange={e =>
                        updateSettingsDraft({
                          routeFee: Number(e.target.value)
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Pickup-Only Multiplier
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      step="0.01"
                      value={settingsDraft.pickupOnlyMultiplier}
                      onChange={e =>
                        updateSettingsDraft({
                          pickupOnlyMultiplier: Number(e.target.value)
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Distance Included Miles
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      step="0.1"
                      value={settingsDraft.distanceIncludedMiles}
                      onChange={e =>
                        updateSettingsDraft({
                          distanceIncludedMiles: Number(e.target.value)
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Distance Band 1 Max Miles
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      step="0.1"
                      value={settingsDraft.distanceBand1MaxMiles}
                      onChange={e =>
                        updateSettingsDraft({
                          distanceBand1MaxMiles: Number(e.target.value)
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Distance Band 2 Max Miles
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      step="0.1"
                      value={settingsDraft.distanceBand2MaxMiles}
                      onChange={e =>
                        updateSettingsDraft({
                          distanceBand2MaxMiles: Number(e.target.value)
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Distance Band 1 Rate (per mile)
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      step="0.01"
                      value={settingsDraft.distanceBand1Rate}
                      onChange={e =>
                        updateSettingsDraft({
                          distanceBand1Rate: Number(e.target.value)
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Distance Band 2 Rate (per mile)
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      step="0.01"
                      value={settingsDraft.distanceBand2Rate}
                      onChange={e =>
                        updateSettingsDraft({
                          distanceBand2Rate: Number(e.target.value)
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Distance Band 3 Rate (per mile)
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      step="0.01"
                      value={settingsDraft.distanceBand3Rate}
                      onChange={e =>
                        updateSettingsDraft({
                          distanceBand3Rate: Number(e.target.value)
                        })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5 space-y-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Hub Coordinates
                </p>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Hub Latitude
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      step="0.000001"
                      value={settingsDraft.hubLat ?? ''}
                      onChange={e =>
                        updateSettingsDraft({
                          hubLat: e.target.value === '' ? null : Number(e.target.value)
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Hub Longitude
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      step="0.000001"
                      value={settingsDraft.hubLng ?? ''}
                      onChange={e =>
                        updateSettingsDraft({
                          hubLng: e.target.value === '' ? null : Number(e.target.value)
                        })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5 space-y-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Checkout Rules
                </p>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-ninpo-lime"
                      checked={settingsDraft.allowGuestCheckout}
                      onChange={e =>
                        updateSettingsDraft({
                          allowGuestCheckout: e.target.checked
                        })
                      }
                    />
                    Allow guest checkout
                  </label>
                  <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-ninpo-lime"
                      checked={settingsDraft.showAdvancedInventoryInsights}
                      onChange={e =>
                        updateSettingsDraft({
                          showAdvancedInventoryInsights: e.target.checked
                        })
                      }
                    />
                    Show advanced inventory insights
                  </label>
                </div>
              </div>

              <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5 space-y-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Membership
                </p>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-ninpo-lime"
                      checked={settingsDraft.allowPlatinumTier}
                      onChange={e =>
                        updateSettingsDraft({
                          allowPlatinumTier: e.target.checked
                        })
                      }
                    />
                    Allow Platinum tier
                  </label>
                  <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-ninpo-lime"
                      checked={settingsDraft.platinumFreeDelivery}
                      onChange={e =>
                        updateSettingsDraft({
                          platinumFreeDelivery: e.target.checked
                        })
                      }
                    />
                    {/* See GLOSSARY.md for Route Fee and Platinum tier definitions */}
                    Free Route Fee for Platinum tier
                  </label>
                </div>
              </div>

              <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5 space-y-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Scanning Settings
                </p>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Default Increment
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      min="1"
                      value={settingsDraft.defaultIncrement ?? 1}
                      onChange={e =>
                        updateSettingsDraft({
                          defaultIncrement: Number(e.target.value)
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Cooldown (ms)
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      min="0"
                      value={settingsDraft.cooldownMs ?? 1000}
                      onChange={e =>
                        updateSettingsDraft({
                          cooldownMs: Number(e.target.value)
                        })
                      }
                    />
                  </div>
                  <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-ninpo-lime"
                      checked={settingsDraft.requireSkuForScanning ?? true}
                      onChange={e =>
                        updateSettingsDraft({
                          requireSkuForScanning: e.target.checked
                        })
                      }
                    />
                    Require SKU for scanning
                  </label>
                  <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-ninpo-lime"
                      checked={settingsDraft.shelfGroupingEnabled ?? true}
                      onChange={e =>
                        updateSettingsDraft({
                          shelfGroupingEnabled: e.target.checked
                        })
                      }
                    />
                    Enable shelf grouping
                  </label>
                </div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
                {settingsSaved && !settingsDirty
                  ? 'Settings saved.'
                  : settingsDirty
                    ? 'Unsaved changes.'
                    : 'All changes are up to date.'}
              </div>
              <button
                onClick={saveSettings}
                disabled={isSavingSettings || !settingsDirty}
                className="px-8 py-5 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 disabled:opacity-40 disabled:cursor-not-allowed shadow-neon"
              >
                {isSavingSettings ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" />
                )}
                Save Settings
              </button>
            </div>
          </div>
        )}

        {/* =========================
            INVENTORY
        ========================= */}
        {activeModule === 'inventory' && (
          <div className="space-y-6">
            <div className="flex gap-4">
              <button
                onClick={() => setInventoryMode('A')}
                className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
                  inventoryMode === 'A' ? 'bg-ninpo-lime text-ninpo-black' : 'bg-white/5 text-white'
                }`}
              >
                Mode A (Management)
              </button>
              <button
                onClick={() => setInventoryMode('B')}
                className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
                  inventoryMode === 'B' ? 'bg-ninpo-lime text-ninpo-black' : 'bg-white/5 text-white'
                }`}
              >
                Mode B (Audit)
              </button>
            </div>

            {inventoryMode === 'A' && (
              <>
                <h2 className="text-xl font-black uppercase text-white tracking-widest">
                  Inventory Management
                </h2>

                <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
                  <InlineScanner
                    mode={ScannerMode.INVENTORY_CREATE}
                    onScan={handleScannerScan}
                    title="Guided Product Intake"
                    subtitle="Scan UPCs and capture label photos in the scanner so AI can prefill details for verification."
                    beepEnabled={settings.beepEnabled ?? true}
                    cooldownMs={settings.cooldownMs ?? 1000}
                    onPhotoCaptured={handlePhotoCaptured}
                    className="bg-black/30 border-white/10"
                  />

                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    Scanned UPC: <span className="text-white">{scannedUpcForCreation || 'No UPC scanned'}</span>
                  </div>

                  {sanitizedLabelScanError && (
                    <div className="bg-ninpo-card p-4 rounded-2xl border border-ninpo-red/20 text-[11px] text-ninpo-red">
                      {sanitizedLabelScanError}
                    </div>
                  )}

                  <div className="flex flex-col md:flex-row gap-4 items-center">
                    <div className="flex-1 text-[10px] text-slate-500 uppercase tracking-widest">
                      Step 1: Scan the UPC. Step 2: Tap <span className="text-white">Photo</span> in the scanner to
                      capture brand, size, and nutrition panels. Step 3: Review and edit below before creating.
                    </div>
                  </div>

                  {scannedUpcForCreation ? (
                    <div className="pt-6 border-t border-white/5 space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                            Create Product
                          </p>
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest">
                            Storage zone/bin describe where the item sits (e.g., Fridge / Shelf A).
                          </p>
                          {sanitizedLabelScanMessage && (
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-2">
                              {sanitizedLabelScanMessage}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={runLabelScan}
                          disabled={isLabelScanning || !labelScanPhoto || !scannedUpcForCreation}
                          className="px-6 py-4 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isLabelScanning ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <ScanLine className="w-4 h-4" />
                          )}
                          Re-run AI Analysis
                        </button>
                      </div>

                      {createError && (
                        <div className="bg-ninpo-card p-4 rounded-2xl border border-ninpo-red/20 text-[11px] text-ninpo-red">
                          {createError}
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                          <span>SKU</span>
                          <input
                            className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full disabled:opacity-50"
                            placeholder="Auto-generated on creation"
                            value=""
                            disabled
                          />
                        </label>
                        <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                          <span>Name</span>
                          <input
                            className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                            placeholder="Product name"
                            value={newProduct.name}
                            onChange={e =>
                              setNewProduct({ ...newProduct, name: e.target.value })
                            }
                          />
                        </label>
                        <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                          <span>Price</span>
                          <input
                            className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                            placeholder="0.00"
                            type="number"
                            value={newProduct.price}
                            onChange={e =>
                              setNewProduct({ ...newProduct, price: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                          <span>Deposit</span>
                          <input
                            className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                            placeholder="Auto-calculated"
                            value={upcDraft.isEligible ? '0.10' : '0.00'}
                            disabled
                          />
                        </label>
                        <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                          <span>Stock</span>
                          <input
                            className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                            placeholder="0"
                            type="number"
                            value={newProduct.stock}
                            onChange={e =>
                              setNewProduct({ ...newProduct, stock: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                          <span>Size</span>
                          <div className="flex gap-2">
                            <input
                              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                              placeholder="0"
                              type="number"
                              step="0.1"
                              value={newProduct.sizeOz}
                              onChange={e =>
                                setNewProduct({ ...newProduct, sizeOz: Number(e.target.value) })
                              }
                            />
                            <select
                              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                              value={newProduct.sizeUnit}
                              onChange={e =>
                                setNewProduct({
                                  ...newProduct,
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
                        </label>
                        <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                          <span>Brand</span>
                          <input
                            className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                            placeholder="Brand"
                            value={newProduct.brand}
                            onChange={e =>
                              setNewProduct({ ...newProduct, brand: e.target.value })
                            }
                          />
                        </label>
                        <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                          <span>Product Type</span>
                          <input
                            className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                            placeholder="Type"
                            value={newProduct.productType}
                            onChange={e =>
                              setNewProduct({ ...newProduct, productType: e.target.value })
                            }
                          />
                        </label>
                        <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600 md:col-span-2">
                          <span>Nutrition Note (Customer Info)</span>
                          <textarea
                            className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full min-h-[96px]"
                            placeholder="e.g. 12g protein • 220 calories • contains peanuts"
                            value={newProduct.nutritionNote}
                            onChange={e =>
                              setNewProduct({
                                ...newProduct,
                                nutritionNote: e.target.value
                              })
                            }
                          />
                        </label>
                        <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                          <span>Storage Zone</span>
                          <input
                            className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                            placeholder="Zone"
                            value={newProduct.storageZone}
                            onChange={e =>
                              setNewProduct({
                                ...newProduct,
                                storageZone: e.target.value
                              })
                            }
                          />
                        </label>
                        <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                          <span>Storage Bin</span>
                          <input
                            className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                            placeholder="Bin"
                            value={newProduct.storageBin}
                            onChange={e =>
                              setNewProduct({ ...newProduct, storageBin: e.target.value })
                            }
                          />
                        </label>
                        <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600 md:col-span-2">
                          <span>Image URL</span>
                          <input
                            className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                            placeholder="https://"
                            value={newProduct.image}
                            onChange={e =>
                              setNewProduct({ ...newProduct, image: e.target.value })
                            }
                          />
                        </label>
                      </div>

                      <div className="md:col-span-2">
                        <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                          <input
                            type="checkbox"
                            checked={upcDraft.isEligible}
                            onChange={e =>
                              setUpcDraft({ ...upcDraft, isEligible: e.target.checked })
                            }
                          />
                          Eligible for Michigan Deposit Refund
                        </label>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={handleCancelCreate}
                          className="w-full py-5 bg-black/40 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 border border-white/10 hover:border-white/30 transition-all"
                        >
                          <X className="w-5 h-5" />
                          Cancel
                        </button>
                        <button
                          onClick={apiCreateProduct}
                          disabled={isCreating}
                          className="w-full py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.01] transition-all shadow-neon"
                        >
                          {isCreating ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Plus className="w-5 h-5" />
                          )}
                          Create
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-6 border-t border-white/5 text-[10px] text-slate-500 uppercase tracking-widest">
                      Scan a UPC to open the product details before creating.
                    </div>
                  )}
                </div>

                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    Inventory List
                  </p>
                  <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-600">
                    <span>Sort</span>
                    <select
                      value={inventorySort}
                      onChange={e =>
                        setInventorySort(
                          e.target.value as
                            | 'alpha'
                            | 'price'
                            | 'brand'
                            | 'type'
                            | 'storage-zone'
                            | 'storage-bin'
                        )
                      }
                      className="bg-black/40 border border-white/10 rounded-2xl px-4 py-2 text-sm text-white"
                    >
                      <option value="alpha">Alphabetical (A-Z)</option>
                      <option value="price">Price</option>
                      <option value="brand">Brand (A-Z)</option>
                      <option value="type">Product Type</option>
                      <option value="storage-zone">Storage Zone</option>
                      <option value="storage-bin">Storage Bin</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-6">
                  {sortedProducts.map(p => (
                    <div
                      key={p.id}
                      className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                    >
                      <div>
                        <p className="text-white font-black">{p.name}</p>
                        <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest mt-1">
                          SKU: {p.sku || p.id} • Stock: {p.stock} •{' '}
                          {formatSize(p.sizeOz, p.sizeUnit)} • $
                          {Number(p.price || 0).toFixed(2)}
                        </p>
                        <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest mt-1">
                          {p.brand || 'No Brand'} • {p.productType || 'No Type'} • {p.storageZone || 'No Zone'} / {p.storageBin || 'No Bin'}
                        </p>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={() => startEditProduct(p)}
                          className="px-6 py-3 rounded-2xl bg-white/5 text-white/70 text-[10px] font-black uppercase tracking-widest border border-white/10"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => apiRestockPlus10(p.id, p.stock)}
                          className="px-6 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                        >
                          +10 Stock
                        </button>
                        <button
                          onClick={() => apiDeleteProduct(p.id)}
                          className="px-6 py-3 rounded-2xl bg-ninpo-red/10 text-ninpo-red text-[10px] font-black uppercase tracking-widest border border-ninpo-red/20"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {inventoryMode === 'B' && (
              <div className="space-y-6">
                <h2 className="text-xl font-black uppercase text-white tracking-widest">
                  Inventory Count/Audit
                </h2>

                <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
                  <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                    <span>Select Location</span>
                    <select
                      value={selectedLocation}
                      onChange={e => setSelectedLocation(e.target.value)}
                      className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                    >
                      <option value="">Select Location</option>
                      {[...new Set(products.map(p => p.storageZone).filter(Boolean))].map(zone => (
                        <option key={zone} value={zone}>{zone}</option>
                      ))}
                    </select>
                  </label>

                  {selectedLocation && (
                    <>
                      <div className="flex flex-col md:flex-row gap-4">
                        <input
                          className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white flex-1"
                          placeholder="Scan or enter UPC"
                          value={auditUpcInput}
                          onChange={e => setAuditUpcInput(e.target.value)}
                        />
                        <button
                          onClick={() => {
                            setScannerMode(ScannerMode.INVENTORY_AUDIT);
                            setScannerModalOpen(true);
                          }}
                          className="px-6 py-4 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
                        >
                          <ScanLine className="w-4 h-4" /> Scan
                        </button>
                        <button
                          onClick={() => handleAuditScan(auditUpcInput.trim(), 1)}
                          className="px-6 py-4 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                        >
                          Count Item
                        </button>
                      </div>

                      {auditError && (
                        <div className="bg-ninpo-card p-4 rounded-2xl border border-ninpo-red/20 text-[11px] text-ninpo-red">
                          {auditError}
                        </div>
                      )}

                      <div className="space-y-4">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                          Counted Items at {selectedLocation}
                        </h3>
                        {Object.entries(auditCounts).map(([productId, count]) => {
                          const product = products.find(p => p.id === productId);
                          return (
                            <div key={productId} className="bg-black/30 rounded-2xl p-4 border border-white/5 flex justify-between">
                              <span className="text-white font-semibold">{product?.name || 'Unknown'}</span>
                              <span className="text-slate-400">Count: {count}</span>
                            </div>
                          );
                        })}
                        {Object.keys(auditCounts).length === 0 && (
                          <p className="text-slate-500 text-[10px] uppercase tracking-widest">No items counted yet.</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

          </div>
        )}

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
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                placeholder="Name"
                value={editDraft.name}
                onChange={e => setEditDraft({ ...editDraft, name: e.target.value })}
              />
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                placeholder="Category"
                value={editDraft.category}
                onChange={e => setEditDraft({ ...editDraft, category: e.target.value })}
              />
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                placeholder="Brand"
                value={editDraft.brand}
                onChange={e => setEditDraft({ ...editDraft, brand: e.target.value })}
              />
              <input
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
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                placeholder="Storage Zone"
                value={editDraft.storageZone}
                onChange={e => setEditDraft({ ...editDraft, storageZone: e.target.value })}
              />
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                placeholder="Storage Bin"
                value={editDraft.storageBin}
                onChange={e => setEditDraft({ ...editDraft, storageBin: e.target.value })}
              />
              <input
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
                className="w-full py-4 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
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
              </div>
              <button
                className="px-5 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
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
          isAnalyzing={isLabelScanning}
          onClose={() => setUnmappedUpcModalOpen(false)}
          onAnalyze={() => {
            setScannerMode(ScannerMode.INVENTORY_CREATE);
            setScannerModalOpen(!isInlineInventoryScanner);
          }}
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
        onClose={() => setScannerModalOpen(false)}
        title={
          scannerMode === ScannerMode.INVENTORY_CREATE ? 'Scan Product' :
          scannerMode === ScannerMode.UPC_LOOKUP ? 'Scan UPC' :
          scannerMode === ScannerMode.INVENTORY_AUDIT ? 'Count Item' :
          'Scan'
        }
        subtitle={
          scannerMode === ScannerMode.INVENTORY_CREATE ? 'Scan UPC and capture photo for AI analysis' :
          scannerMode === ScannerMode.UPC_LOOKUP ? 'Scan UPC to lookup or edit registry entry' :
          scannerMode === ScannerMode.INVENTORY_AUDIT ? 'Scan UPC to count inventory' :
          'Scan barcode'
        }
        beepEnabled={settings.beepEnabled ?? true}
        cooldownMs={settings.cooldownMs ?? 1000}
        isOpen={scannerModalOpen}
        onPhotoCaptured={scannerMode === ScannerMode.INVENTORY_CREATE ? handlePhotoCaptured : undefined}
        closeOnScan={false}
        manualStart={scannerMode === ScannerMode.INVENTORY_CREATE}
      />
      </div>
    </div>
  );
};

export default ManagementView;
