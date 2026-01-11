import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  User,
  Product,
  Order,
  OrderStatus,
  UpcItem,
  AppSettings,
  ApprovalRequest,
  AuditLog,
  UserStatsSummary,
  LedgerEntry
} from '../types';
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
  Camera
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { getAdvancedInventoryInsights } from '../services/geminiService';

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

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
  setApprovals: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
  auditLogs: AuditLog[];
  updateOrder: (id: string, status: OrderStatus, metadata?: any) => void;
  adjustCredits: (userId: string, amount: number, reason: string) => void;
  updateUserProfile: (id: string, updates: Partial<User>) => void;
  fetchUsers: () => Promise<User[]>;
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

const isNewSignupWithBonus = (user: User) => {
  const createdAt = user.createdAt ? new Date(user.createdAt) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
  const ageMs = Date.now() - createdAt.getTime();
  return Number(user.loyaltyPoints || 0) >= 100 && ageMs < 24 * 60 * 60 * 1000;
};

const ManagementView: React.FC<ManagementViewProps> = ({
  products,
  setProducts,
  orders,
  users,
  userStats,
  settings,
  setSettings,
  approvals,
  setApprovals,
  auditLogs,
  updateOrder,
  adjustCredits,
  updateUserProfile,
  fetchUsers
}) => {
  const [activeModule, setActiveModule] = useState<string>('analytics');
  const [isAuditing, setIsAuditing] = useState(false);
  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);
  const [userFilter, setUserFilter] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [userDrafts, setUserDrafts] = useState<Record<string, Partial<User>>>({});
  const [userLedgers, setUserLedgers] = useState<Record<string, LedgerEntry[]>>({});
  const [ledgerLoading, setLedgerLoading] = useState<Record<string, boolean>>({});
  const [ledgerErrors, setLedgerErrors] = useState<Record<string, string | null>>({});
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(settings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Inventory create form
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState({
    id: '',
    name: '',
    price: 0,
    deposit: 0,
    stock: 0,
    category: 'DRINK',
    image: '',
    isGlass: false
  });
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: '',
    price: 0,
    deposit: 0,
    stock: 0,
    category: '',
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
    depositValue: settings.michiganDepositValue || 0.1,
    isGlass: false,
    isEligible: true
  });
  const [isUpcLoading, setIsUpcLoading] = useState(false);
  const [isUpcSaving, setIsUpcSaving] = useState(false);
  const [upcError, setUpcError] = useState<string | null>(null);
  const [upcScannerOpen, setUpcScannerOpen] = useState(false);
  const [upcScannerError, setUpcScannerError] = useState<string | null>(null);
  const [isUpcScanning, setIsUpcScanning] = useState(false);
  const [approvalFilter, setApprovalFilter] =
    useState<ApprovalRequest['status']>('PENDING');
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const allowPlatinumTier = Boolean(settings.allowPlatinumTier);

  const upcVideoRef = useRef<HTMLVideoElement | null>(null);
  const upcStreamRef = useRef<MediaStream | null>(null);
  const upcScanLoopRef = useRef<number | null>(null);
  const upcLastScannedRef = useRef<string>('');
  const upcItemsRef = useRef<UpcItem[]>([]);
  const upcDepositRef = useRef<number>(settings.michiganDepositValue || 0.1);
  const upcAudioContextRef = useRef<AudioContext | null>(null);

  const chartData = useMemo(() => {
    return (orders || [])
      .filter((o: any) => o && (o as any).id)
      .slice(0, 15)
      .map((o: any) => ({
        name: String(o.id).slice(-4),
        revenue: Number(o.total || 0)
      }))
      .reverse();
  }, [orders]);

  const filteredApprovals = useMemo(() => {
    return approvals.filter(approval => approval.status === approvalFilter);
  }, [approvals, approvalFilter]);

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
    if (!settingsDirty) {
      setSettingsDraft(settings);
    }
  }, [settings, settingsDirty]);

  const handleApprove = (approval: ApprovalRequest) => {
    adjustCredits(approval.userId, approval.amount, `AUTH_APPROVED: ${approval.type}`);

    setApprovals(prev =>
      prev.map(a =>
        a.id === approval.id
          ? { ...a, status: 'APPROVED', processedAt: new Date().toISOString() }
          : a
      )
    );

    if (approval.type === 'REFUND' && approval.orderId) {
      updateOrder(approval.orderId, OrderStatus.REFUNDED);
    }
  };

  const handleReject = (id: string) => {
    setApprovals(prev =>
      prev.map(a =>
        a.id === id
          ? { ...a, status: 'REJECTED', processedAt: new Date().toISOString() }
          : a
      )
    );
  };

  const handleLogisticsUpdate = (orderId: string, status: OrderStatus, metadata?: any) => {
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

    const nextSettings: AppSettings = {
      ...settingsDraft,
      michiganDepositValue: Number(settingsDraft.michiganDepositValue || 0),
      dailyReturnLimit: Number(settingsDraft.dailyReturnLimit || 0),
      requirePhotoForRefunds: Boolean(settingsDraft.requirePhotoForRefunds),
      allowGuestCheckout: Boolean(settingsDraft.allowGuestCheckout),
      showAdvancedInventoryInsights: Boolean(settingsDraft.showAdvancedInventoryInsights),
      allowPlatinumTier: Boolean(settingsDraft.allowPlatinumTier)
    };

    try {
      setSettings(nextSettings);
      setSettingsDirty(false);
      setSettingsSaved(true);
    } catch (e: any) {
      setSettingsError(e?.message || 'Failed to save settings');
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

  // ---- UPC Whitelist API (OWNER) ----
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
      depositValue: Number(entry.depositValue || 0),
      isGlass: !!entry.isGlass,
      isEligible: entry.isEligible !== false
    });
  };

  const handleUpcLookup = () => {
    const upc = upcInput.trim();
    if (!upc) {
      setUpcError('UPC is required.');
      return;
    }

    setUpcError(null);
    const existing = upcItems.find(item => item.upc === upc);
    if (existing) {
      loadUpcDraft(existing);
      return;
    }

    setUpcDraft({
      upc,
      name: '',
      depositValue: settings.michiganDepositValue || 0.1,
      isGlass: false,
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
          isGlass: upcDraft.isGlass,
          isEligible: upcDraft.isEligible
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save UPC');
      const saved: UpcItem = data.upcItem;
      setUpcItems(prev => {
        const next = prev.filter(item => item.upc !== saved.upc);
        return [saved, ...next];
      });
      loadUpcDraft(saved);
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
      setUpcDraft({
        upc: '',
        name: '',
        depositValue: settings.michiganDepositValue || 0.1,
        isGlass: false,
        isEligible: true
      });
      setUpcInput('');
    } catch (e: any) {
      setUpcError(e?.message || 'Failed to delete UPC');
    } finally {
      setIsUpcSaving(false);
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

  useEffect(() => {
    upcDepositRef.current = settings.michiganDepositValue || 0.1;
  }, [settings.michiganDepositValue]);

  useEffect(() => {
    if (activeModule !== 'upc') {
      closeUpcScanner();
    }
  }, [activeModule]);

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

  const stopUpcScanner = async () => {
    setIsUpcScanning(false);

    if (upcScanLoopRef.current) {
      window.clearTimeout(upcScanLoopRef.current);
      upcScanLoopRef.current = null;
    }

    if (upcStreamRef.current) {
      try {
        upcStreamRef.current.getTracks().forEach(t => t.stop());
      } catch {
        // ignore
      }
      upcStreamRef.current = null;
    }

    if (upcVideoRef.current) {
      try {
        (upcVideoRef.current as any).srcObject = null;
      } catch {
        // ignore
      }
    }
  };

  const closeUpcScanner = async () => {
    await stopUpcScanner();
    setUpcScannerOpen(false);
    setUpcScannerError(null);
  };

  const openUpcScanner = async () => {
    setUpcScannerError(null);
    upcLastScannedRef.current = '';
    setUpcScannerOpen(true);
  };

  const playUpcBeep = (frequency: number, durationMs: number) => {
    if (typeof window === 'undefined') return;
    if (!upcAudioContextRef.current) {
      upcAudioContextRef.current = new AudioContext();
    }
    const context = upcAudioContextRef.current;
    if (context.state === 'suspended') {
      context.resume();
    }
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gainNode.gain.value = 0.15;
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + durationMs / 1000);
  };

  useEffect(() => {
    if (!upcScannerOpen) return;

    let cancelled = false;

    const start = async () => {
      setUpcScannerError(null);
      await stopUpcScanner();

      const hasBarcodeDetector = typeof (window as any).BarcodeDetector !== 'undefined';
      if (!hasBarcodeDetector) {
        setUpcScannerError('Scanner not supported on this device/browser.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });

        upcStreamRef.current = stream;
        if (upcVideoRef.current) {
          (upcVideoRef.current as any).srcObject = stream;
          await upcVideoRef.current.play();
        }

        if (cancelled) return;

        const detector = new (window as any).BarcodeDetector({
          formats: ['upc_a', 'ean_13', 'ean_8', 'upc_e']
        });

        setIsUpcScanning(true);

        const scanTick = async () => {
          if (!upcScannerOpen || cancelled) return;
          if (!upcVideoRef.current || upcVideoRef.current.readyState < 2) {
            upcScanLoopRef.current = window.setTimeout(scanTick, 250);
            return;
          }

          try {
            const barcodes = await detector.detect(upcVideoRef.current);
            if (Array.isArray(barcodes) && barcodes.length > 0) {
              const rawValue = String(barcodes[0]?.rawValue || '').trim();
              if (rawValue && rawValue !== upcLastScannedRef.current) {
                upcLastScannedRef.current = rawValue;
                setUpcInput(rawValue);
                setUpcError(null);
                playUpcBeep(980, 120);

                const existing = upcItemsRef.current.find(item => item.upc === rawValue);
                if (existing) {
                  loadUpcDraft(existing);
                } else {
                  setUpcDraft({
                    upc: rawValue,
                    name: '',
                    depositValue: upcDepositRef.current,
                    isGlass: false,
                    isEligible: true
                  });
                }

                await new Promise(r => setTimeout(r, 900));
              }
            }
          } catch {
            // ignore detection errors; keep scanning
          }

          upcScanLoopRef.current = window.setTimeout(scanTick, 250);
        };

        scanTick();
      } catch (e: any) {
        setUpcScannerError(e?.message || 'Camera permission denied or unavailable.');
      }
    };

    start();

    return () => {
      cancelled = true;
      stopUpcScanner();
    };
  }, [upcScannerOpen]);

  // ---- Inventory API ----
  const apiCreateProduct = async () => {
    setCreateError(null);
    setIsCreating(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: newProduct.id.trim(),
          name: newProduct.name.trim(),
          price: Number(newProduct.price),
          deposit: Number(newProduct.deposit),
          stock: Number(newProduct.stock),
          category: newProduct.category,
          image: newProduct.image,
          isGlass: !!newProduct.isGlass
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Create failed');

      const created: Product = data.product;
      setProducts(prev => [created, ...prev]);

      setNewProduct({
        id: '',
        name: '',
        price: 0,
        deposit: 0,
        stock: 0,
        category: 'DRINK',
        image: '',
        isGlass: false
      });
    } catch (e: any) {
      setCreateError(e?.message || 'Create failed');
    } finally {
      setIsCreating(false);
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

      const updated: Product = data.product;
      setProducts(prev => prev.map(p => (p.id === id ? updated : p)));
    } catch {
      // silent in UI for now
    }
  };

  const startEditProduct = (product: Product) => {
    setEditError(null);
    setEditingProduct(product);
    setEditDraft({
      name: product.name,
      price: product.price,
      deposit: product.deposit,
      stock: product.stock,
      category: product.category,
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

    if (!name) {
      setEditError('Name is required.');
      return;
    }

    if ([price, deposit, stock].some(value => Number.isNaN(value))) {
      setEditError('Price, deposit, and stock must be valid numbers.');
      return;
    }

    const updates: Partial<Product> = {};

    if (name !== editingProduct.name) updates.name = name;
    if (price !== editingProduct.price) updates.price = price;
    if (deposit !== editingProduct.deposit) updates.deposit = deposit;
    if (stock !== editingProduct.stock) updates.stock = stock;
    if (editDraft.category !== editingProduct.category) updates.category = editDraft.category;
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

      const updated: Product = data.product;
      setProducts(prev => prev.map(p => (p.id === updated.id ? updated : p)));
      setEditingProduct(null);
    } catch (e: any) {
      setEditError(e?.message || 'Update failed');
    } finally {
      setIsSavingEdit(false);
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

  const runAudit = async () => {
    setIsAuditing(true);
    try {
      const report = await getAdvancedInventoryInsights(products as any, orders as any);
      setAiInsights(report || 'NO OUTPUT');
    } catch {
      setAiInsights('Audit transmission interrupted.');
    } finally {
      setIsAuditing(false);
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

  return (
    <div className="flex flex-col xl:flex-row gap-12 animate-in fade-in pb-32">
      <aside className="w-full xl:w-72 space-y-2">
        {[
          { id: 'analytics', label: 'Dashboard', icon: BarChart3 },
          { id: 'orders', label: 'Orders', icon: Truck },
          { id: 'approvals', label: 'Auth Hub', icon: ShieldCheck },
          { id: 'inventory', label: 'Inventory', icon: Package },
          { id: 'upc', label: 'UPC Whitelist', icon: ScanLine },
          { id: 'users', label: 'Users', icon: Users },
          { id: 'logs', label: 'Audit Logs', icon: Terminal },
          { id: 'settings', label: 'Settings', icon: Sliders }
        ].map(m => (
          <button
            key={m.id}
            onClick={() => setActiveModule(m.id)}
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

      <div className="flex-1 space-y-8">
        {activeModule === 'analytics' && (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div>
                <h2 className="text-xl font-black uppercase text-white tracking-widest">
                  Main Dashboard
                </h2>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
                  Revenue snapshots & operational pulse
                </p>
              </div>

              <button
                onClick={runAudit}
                disabled={isAuditing}
                className="px-8 py-5 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 transition-all flex items-center gap-3"
              >
                {isAuditing ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <BrainCircuit className="w-6 h-6" />
                )}
                Run Audit
              </button>
            </div>

            {aiInsights && (
              <div className="bg-ninpo-midnight p-8 rounded-[2rem] border border-ninpo-lime/20 text-xs text-slate-300 leading-relaxed shadow-xl whitespace-pre-wrap">
                <p className="font-black text-ninpo-lime uppercase mb-4 tracking-widest flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" /> Audit Report
                </p>
                {aiInsights}
              </div>
            )}

            <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5 h-80 min-h-[320px]">
              {isChartReady ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                    <XAxis dataKey="name" stroke="#555" fontSize={9} />
                    <YAxis stroke="#555" fontSize={9} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#111',
                        border: 'none',
                        borderRadius: '1rem',
                        fontSize: '10px'
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="#00ff41"
                      strokeWidth={3}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Loading chart…
                </div>
              )}
            </div>
          </div>
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
                orders.map(o => (
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
                            <span className="md:hidden">Est Credit:</span>
                            <span className="text-slate-300">
                              Est Credit: ${Number(o.estimatedReturnCredit || 0).toFixed(2)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between md:justify-end md:gap-3">
                            <span className="md:hidden">Verified:</span>
                            <span className="text-slate-300">
                              Verified:{' '}
                              {o.verifiedReturnCredit === undefined
                                ? '—'
                                : `$${Number(o.verifiedReturnCredit || 0).toFixed(2)}`}
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

                    {/* ACTIONS */}
                    <div className="flex flex-col md:flex-row gap-4 border-t border-white/5 pt-6">
                      {/* Assign to Me (owner-as-driver) */}
                      {(o.status === OrderStatus.PENDING || o.status === OrderStatus.PAID) && (
                        <button
                          onClick={() =>
                            handleLogisticsUpdate(o.id, OrderStatus.ASSIGNED, { driverId: 'OWNER' })
                          }
                          className="flex-1 py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all shadow-neon"
                        >
                          <UserCheck className="w-5 h-5" /> Assign to Me
                        </button>
                      )}

                      {/* Progress buttons */}
                      {o.status === OrderStatus.PAID && (
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
                ))
              )}
            </div>
          </div>
        )}

        {/* =========================
            APPROVALS
        ========================= */}
        {activeModule === 'approvals' && (
          <div className="space-y-6">
            <h2 className="text-xl font-black uppercase text-white tracking-widest">
              Authentication Hub
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
                  const tierLabel = (u.membershipTier || 'BRONZE').toString().toUpperCase();
                  const showSignupBonus = isNewSignupWithBonus(u);

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
                                tierLabel
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
                            Orders: {stats?.orderCount ?? 0}
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
                                <span className="text-slate-200 font-bold">
                                  ${Number(stats?.totalSpend || 0).toFixed(2)}
                                </span>
                              </p>
                              <p>
                                Last Order:{' '}
                                <span className="text-slate-200 font-bold">
                                  {stats?.lastOrderAt ? fmtTime(stats.lastOrderAt) : '—'}
                                </span>
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
                                value={(draft.membershipTier ?? u.membershipTier ?? 'BRONZE').toString()}
                                onClick={e => e.stopPropagation()}
                                disabled={!allowPlatinumTier && u.membershipTier === 'PLATINUM'}
                                onChange={e =>
                                  handleUserDraftChange(u.id, {
                                    membershipTier: e.target.value as any
                                  })
                                }
                              >
                                <option value="BRONZE">Bronze</option>
                                <option value="SILVER">Silver</option>
                                <option value="GOLD">Gold</option>
                                {(allowPlatinumTier || u.membershipTier === 'PLATINUM') && (
                                  <option value="PLATINUM" disabled={!allowPlatinumTier}>
                                    Platinum (secret)
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

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5 space-y-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Returns Rules
                </p>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Michigan Deposit Value
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      step="0.01"
                      value={settingsDraft.michiganDepositValue}
                      onChange={e =>
                        updateSettingsDraft({
                          michiganDepositValue: Number(e.target.value)
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Daily Return Limit
                    </label>
                    <input
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                      type="number"
                      step="0.01"
                      value={settingsDraft.dailyReturnLimit}
                      onChange={e =>
                        updateSettingsDraft({
                          dailyReturnLimit: Number(e.target.value)
                        })
                      }
                    />
                  </div>
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
            <h2 className="text-xl font-black uppercase text-white tracking-widest">
              Inventory
            </h2>

            <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                Create Product
              </p>

              {createError && (
                <div className="bg-ninpo-card p-4 rounded-2xl border border-ninpo-red/20 text-[11px] text-ninpo-red">
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="ID (e.g. coke-12oz)"
                  value={newProduct.id}
                  onChange={e => setNewProduct({ ...newProduct, id: e.target.value })}
                />
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Name"
                  value={newProduct.name}
                  onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
                />
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Price"
                  type="number"
                  value={newProduct.price}
                  onChange={e => setNewProduct({ ...newProduct, price: Number(e.target.value) })}
                />
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Deposit"
                  type="number"
                  value={newProduct.deposit}
                  onChange={e => setNewProduct({ ...newProduct, deposit: Number(e.target.value) })}
                />
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Stock"
                  type="number"
                  value={newProduct.stock}
                  onChange={e => setNewProduct({ ...newProduct, stock: Number(e.target.value) })}
                />
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white md:col-span-2"
                  placeholder="Image URL"
                  value={newProduct.image}
                  onChange={e => setNewProduct({ ...newProduct, image: e.target.value })}
                />
              </div>

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

            <div className="grid grid-cols-1 gap-6">
              {products.map(p => (
                <div
                  key={p.id}
                  className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                >
                  <div>
                    <p className="text-white font-black">{p.name}</p>
                    <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest mt-1">
                      ID: {p.id} • Stock: {p.stock}
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
          </div>
        )}

        {/* =========================
            UPC WHITELIST
        ========================= */}
        {activeModule === 'upc' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-black uppercase text-white tracking-widest">
                UPC Whitelist
              </h2>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
                Scan UPCs, confirm eligibility, and store deposit metadata.
              </p>
            </div>

            <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                Scanner Input
              </p>

              {upcError && (
                <div className="bg-ninpo-card p-4 rounded-2xl border border-ninpo-red/20 text-[11px] text-ninpo-red">
                  {upcError}
                </div>
              )}

              <div className="flex flex-col md:flex-row gap-4">
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white flex-1"
                  placeholder="Scan or enter UPC"
                  value={upcInput}
                  onChange={e => setUpcInput(e.target.value)}
                />
                <button
                  onClick={openUpcScanner}
                  className="px-6 py-4 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  <ScanLine className="w-4 h-4" /> Scan
                </button>
                <button
                  onClick={handleUpcLookup}
                  className="px-6 py-4 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                >
                  Load
                </button>
                <button
                  onClick={apiSaveUpc}
                  disabled={isUpcSaving}
                  className="px-6 py-4 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest"
                >
                  {isUpcSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={apiDeleteUpc}
                  disabled={isUpcSaving || !upcDraft.upc}
                  className="px-6 py-4 rounded-2xl bg-ninpo-red/10 text-ninpo-red text-[10px] font-black uppercase tracking-widest border border-ninpo-red/20"
                >
                  Delete
                </button>
              </div>

              {upcScannerOpen && (
                <div className="fixed inset-0 z-[14000] flex items-center justify-center p-6">
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={closeUpcScanner} />
                  <div className="relative w-full max-w-lg bg-ninpo-black border border-white/10 rounded-[2.5rem] p-6 shadow-2xl">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-white font-black uppercase tracking-widest text-sm">
                          UPC Scanner
                        </p>
                        <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-1">
                          Point the camera at the barcode to populate the whitelist form.
                        </p>
                      </div>
                      <button
                        onClick={closeUpcScanner}
                        className="p-3 rounded-2xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="mt-5 rounded-3xl overflow-hidden border border-white/10 bg-black/40 aspect-video flex items-center justify-center relative">
                      <video ref={upcVideoRef} className="w-full h-full object-cover" playsInline muted />
                      {isUpcScanning && <span className="scanning-line" />}
                      {!isUpcScanning && (
                        <div className="absolute text-center px-8">
                          <Camera className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                            {upcScannerError ? 'Scanner unavailable' : 'Initializing camera...'}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                        Latest: <span className="text-white">{upcInput || '—'}</span>
                      </div>
                      <button
                        onClick={closeUpcScanner}
                        className="px-5 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
                      >
                        <ScanLine className="w-4 h-4" /> Done
                      </button>
                    </div>

                    {upcScannerError && (
                      <div className="mt-4 text-[11px] text-ninpo-red bg-ninpo-red/10 border border-ninpo-red/20 rounded-2xl p-4">
                        {upcScannerError}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Name / Description"
                  value={upcDraft.name}
                  onChange={e => setUpcDraft({ ...upcDraft, name: e.target.value })}
                />
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Deposit Value"
                  type="number"
                  value={upcDraft.depositValue}
                  onChange={e =>
                    setUpcDraft({ ...upcDraft, depositValue: Number(e.target.value) })
                  }
                />
                <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <input
                    type="checkbox"
                    checked={upcDraft.isGlass}
                    onChange={e => setUpcDraft({ ...upcDraft, isGlass: e.target.checked })}
                  />
                  Glass Container
                </label>
                <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <input
                    type="checkbox"
                    checked={upcDraft.isEligible}
                    onChange={e =>
                      setUpcDraft({ ...upcDraft, isEligible: e.target.checked })
                    }
                  />
                  Eligible for MI Deposit
                </label>
              </div>
            </div>

            <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Whitelist Entries
                </p>
                <div className="flex gap-3">
                  <input
                    className="bg-black/40 border border-white/10 rounded-2xl p-3 text-xs text-white"
                    placeholder="Filter by UPC or name"
                    value={upcFilter}
                    onChange={e => setUpcFilter(e.target.value)}
                  />
                  <button
                    onClick={apiLoadUpcItems}
                    disabled={isUpcLoading}
                    className="px-5 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                  >
                    {isUpcLoading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
              </div>

              {isUpcLoading ? (
                <p className="text-xs text-slate-500">Loading UPC entries...</p>
              ) : filteredUpcItems.length === 0 ? (
                <p className="text-xs text-slate-500">
                  {upcItems.length === 0
                    ? 'No UPC entries yet. Scan a code to begin.'
                    : 'No UPC entries match this filter.'}
                </p>
              ) : (
                <div className="space-y-3">
                  {filteredUpcItems.map(item => (
                    <button
                      key={item.upc}
                      onClick={() => {
                        setUpcInput(item.upc);
                        loadUpcDraft(item);
                      }}
                      className="w-full text-left p-4 rounded-2xl border border-white/5 bg-black/40 hover:bg-white/5 transition-all"
                    >
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                        <div>
                          <p className="text-white text-sm font-black">{item.upc}</p>
                          <p className="text-[10px] uppercase tracking-widest text-slate-500">
                            {item.name || 'Unnamed'} • $
                            {Number(item.depositValue || 0).toFixed(2)} •{' '}
                            {item.isGlass ? 'GLASS' : 'PLASTIC'} •{' '}
                            {item.isEligible ? 'ELIGIBLE' : 'INELIGIBLE'}
                          </p>
                        </div>
                        <p className="text-[10px] uppercase tracking-widest text-slate-600">
                          Updated {fmtTime(item.updatedAt)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
    </div>
  );
};

export default ManagementView;
