/**
 * See GLOSSARY.md for authoritative definitions of all roles.
 */
export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  DRIVER = 'DRIVER',

  // Preferred name going forward (what you called “admin”)
  ADMIN = 'ADMIN',

  // Backwards-compat: existing systems may still return OWNER
  OWNER = 'OWNER'
}

/**
 * See GLOSSARY.md for authoritative definitions of all order statuses.
 */
export enum OrderStatus {
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  PAID = 'PAID',
  ASSIGNED = 'ASSIGNED',
  PICKED_UP = 'PICKED_UP',
  ARRIVING = 'ARRIVING',
  DELIVERED = 'DELIVERED',
  REFUND_REQUESTED = 'REFUND_REQUESTED',
  REFUNDED = 'REFUNDED',
  CLOSED = 'CLOSED'
}

/**
 * Scanner modes are *intents* for the single ScannerModal.
 * See GLOSSARY.md for authoritative definitions of all scanner modes.
 * Your UI should decide which mode it opens with, and your handler
 * must enforce what actions are allowed per mode.
 */
export enum ScannerMode {
  // Admin (inventory)
  INVENTORY_CREATE = 'INVENTORY_CREATE',
  // Admin (UPC registry)
  UPC_LOOKUP = 'UPC_LOOKUP',

  // Driver verification
  DRIVER_VERIFY_CONTAINERS = 'DRIVER_VERIFY_CONTAINERS',

  // Customer return scanning
  CUSTOMER_RETURN_SCAN = 'CUSTOMER_RETURN_SCAN'
}

export type PaymentMethod = 'STRIPE_CARD' | 'GOOGLE_PAY' | 'CREDITS';

export enum UserTier {
  COMMON = 'COMMON',
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
  GREEN = 'GREEN'
}

export interface User {
  id: string;
  name?: string;
  username?: string;
  role: UserRole;
  creditBalance: number;
  loyaltyPoints?: number;
  membershipTier: UserTier;
  ordersCompleted?: number;
  phoneVerified?: boolean;
  photoIdVerified?: boolean;
  createdAt?: string;
}

export interface UserStatsSummary {
  userId: string;
  orderCount: number;
  totalSpend: number;
  lastOrderAt?: string | null;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  delta: number;
  reason: string;
  createdAt?: string;
}

export interface Product {
  id: string;
  sku?: string;
  upc?: string;
  name: string;
  price: number;
  deposit: number;
  stock: number;
  sizeOz: number;
  sizeUnit?: SizeUnit;
  category: string;
  image: string;
  brand?: string;
  productType?: string;
  nutritionNote?: string;
  storageZone?: string;
  storageBin?: string;
  isGlass: boolean;
}

export type SizeUnit = 'oz' | 'fl oz' | 'g' | 'kg' | 'ml' | 'l';

export type UpcContainerType = 'aluminum' | 'glass' | 'plastic';

export interface UpcItem {
  upc: string;
  name: string;
  depositValue: number;
  price: number;
  containerType: UpcContainerType;
  sizeOz: number;
  sizeUnit?: SizeUnit;
  isEligible: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface UnmappedUpcData {
  upc: string;
  name?: string;
  price?: number;
  deposit?: number;
  sizeOz?: number;
  category?: string;
}

export interface ReturnUpcCount {
  upc: string;
  quantity: number;
}

export interface ReturnAiAnalysis {
  confidence?: number;
  flags?: string[];
  summary?: string;
  assessedAt?: string;
}

export interface Order {
  id: string;
  customerId: string;
  driverId?: string;
  items: { productId: string; quantity: number }[];
  total: number;

  orderType?: 'DELIVERY_PURCHASE' | 'RETURNS_PICKUP';
  routeFee?: number;
  distanceMiles?: number;
  distanceFee?: number;

  creditAuthorizedCents?: number;
  creditAppliedCents?: number;

  estimatedReturnCreditGross?: number;
  estimatedReturnCredit: number;

  verifiedReturnCreditGross?: number;
  verifiedReturnCredit?: number;

  returnPayoutMethod?: 'CREDIT' | 'CASH';

  returnUpcs?: string[];
  verifiedReturnUpcs?: string[];
  returnUpcCounts?: ReturnUpcCount[];
  verifiedReturnUpcCounts?: ReturnUpcCount[];

  // Dollars (derived from Stripe cents fields on backend)
  authorizedAmount?: number;
  capturedAmount?: number;

  paymentMethod: PaymentMethod;
  address: string;
  status: OrderStatus;
  createdAt: string;

  paidAt?: string;
  deliveredAt?: string;
  refundRequestedAt?: string;

  verificationPhoto?: string;
  returnPhoto?: string;
  returnAiAnalysis?: ReturnAiAnalysis;

  gpsCoords?: { lat: number; lng: number };
}

export interface AppSettings {
    dailyReturnLimit: number;
    glassHandlingFeePercent: number;
    michiganDepositValue: number;
    processingFeePercent: number;
    returnProcessingFeePercent: number;
    glassHandlingFeePerContainer: number;
    returnHandlingFeePerContainer: number;
  routeFee: number;
  referralBonus: number;
  pickupOnlyMultiplier: number;
  distanceIncludedMiles: number;
  distanceBand1MaxMiles: number;
  distanceBand2MaxMiles: number;
  distanceBand1Rate: number;
  distanceBand2Rate: number;
  distanceBand3Rate: number;

  hubLat: number | null;
  hubLng: number | null;

  maintenanceMode: boolean;
  requirePhotoForRefunds: boolean;
  allowGuestCheckout: boolean;
  showAdvancedInventoryInsights: boolean;

  allowPlatinumTier: boolean;
  platinumFreeDelivery: boolean;

  storageZones: string[];
  productTypes: string[];

  /**
   * Replaces legacy A/B/C/D.
   * These are UI feature flags for which scanning experiences are enabled.
   */
  scanningModesEnabled: {
    inventoryCreate: boolean;
    upcLookup: boolean;
    driverVerifyContainers: boolean;
    customerReturnScan: boolean;
  };

  defaultIncrement: number;
  cooldownMs: number;

  // IMPORTANT: your UI references this; it must exist.
  beepEnabled: boolean;

  requireSkuForScanning: boolean;
  shelfGroupingEnabled: boolean;
}

export type ApprovalType = 'REFUND' | 'CREDIT_ADJUSTMENT' | 'MEMBERSHIP_UPGRADE';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ApprovalRequest {
  id: string;
  type: ApprovalType;
  userId: string;
  amount: number;
  orderId?: string;
  reason?: string;
  photoProof?: string;
  status: ApprovalStatus;
  createdAt: string;
  processedAt?: string;
}

export type AuditLogType =
  | 'LOGIN'
  | 'LOGOUT'
  | 'ORDER_CREATED'
  | 'ORDER_UPDATED'
  | 'ORDER_CANCELED'
  | 'ORDER_RETURN_BACKFILL'
  | 'PRODUCT_CREATED'
  | 'PRODUCT_UPDATED'
  | 'PRODUCT_DELETED'
  | 'CREDIT_ADJUSTED'
  | 'APPROVAL_APPROVED'
  | 'APPROVAL_REJECTED'
  | 'SETTINGS_UPDATED';

export interface AuditLog {
  id: string;
  type: AuditLogType;
  actorId: string;
  details: string;
  createdAt: string;
}

export interface ReturnVerification {
  id: string;
  orderId: string;
  driverId: string;
  customerId: string;

  scans?: { upc: string; timestamp: string }[];

  recognizedCount: number;
  unrecognizedCount: number;
  duplicatesCount?: number;

  conditionFlags?: string[];

  submittedAt: string;

  status: 'SUBMITTED' | 'REVIEWED' | 'APPROVED' | 'REJECTED';
  reviewNotes?: string;
}

export interface ReturnSettlement {
  id: string;
  verificationId: string;
  finalAcceptedCount: number;
  creditAmount: number;
  cashAmount: number;
  feesApplied: number;
  settledAt: string;
  settledBy: string;
}
