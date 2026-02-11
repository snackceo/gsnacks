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
 * Scanner modes are *intents* for UPC/barcode capture (shared ScannerModal).
 * **Receipt Scanner is separate** — dedicated full-screen camera for receipt capture with auto-parse.
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
  // Driver fulfillment scanning (Mode D - pack validation)
  DRIVER_FULFILL_ORDER = 'DRIVER_FULFILL_ORDER',

  // Customer return scanning
  CUSTOMER_RETURN_SCAN = 'CUSTOMER_RETURN_SCAN',

  // Receipt parsing with live camera
  RECEIPT_PARSE_LIVE = 'RECEIPT_PARSE_LIVE'
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
  productId?: string;
  name: string;
  price: number;
  deposit: number;
  stock: number;
  sizeOz: number;
  isTaxable?: boolean;
  sizeUnit?: SizeUnit;
  category: string;
  image: string;
  brand?: string;
  productType?: string;
  nutritionNote?: string;
  storageZone?: string;
  storageBin?: string;
  isGlass: boolean;
  isHeavy?: boolean;
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

export interface AddressObject {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface StoreRecord {
  id: string;
  name: string;
  phone?: string;
  address?: AddressObject | string;
  storeType?: string;
  createdFrom?: string;
  createdAt?: string;
  location?: { lat?: number; lng?: number };
  isPrimarySupplier?: boolean;
}

export interface StoreInventoryEntry {
  _id: string;
  storeId: string;
  sku?: string;
  cost?: number;
  markup?: number;
  observedPrice?: number;
  observedAt?: string;
  available?: boolean;
  stockLevel?: 'in-stock' | 'low-stock' | 'out-of-stock';
  priceDrift?: string | null;
  productId?: {
    _id?: string;
    id?: string;
    name?: string;
    sku?: string;
    upc?: string;
    price?: number;
  };
  unmappedProductId?: {
    _id?: string;
    rawName?: string;
    normalizedName?: string;
  };
}

export interface StoreInventoryResponse {
  ok: boolean;
  items: StoreInventoryEntry[];
  error?: string;
}

export type FinalStoreMode = 'MATCHED' | 'EXISTING' | 'CREATE_DRAFT';

export type ReceiptApprovalAction =
  | 'LINK_UPC_TO_PRODUCT'
  | 'CREATE_UPC'
  | 'CAPTURE_UNMAPPED'
  | 'CREATE_PRODUCT'
  | 'IGNORE';


export interface StoreMatchReasonDetail {
  code: string;
  message: string;
  weight: number;
}

export interface StoreMatchCandidateOption {
  storeId: string;
  name: string;
  confidence: number;
  score: number;
  reasonCodes: string[];
  reasons: StoreMatchReasonDetail[];
  address?: AddressObject;
  phone?: string;
}

export type ReceiptParseStatus =
  | 'QUEUED'
  | 'PARSING'
  | 'PARSED'
  | 'NEEDS_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'FAILED';

export interface ReceiptStoreCandidate {
  name?: string;
  address?: AddressObject;
  phone?: string;
  storeType?: string;
  confidence?: number;
  matchReason?: string;
  storeId?: string;
  isAmbiguous?: boolean;
  candidates?: StoreMatchCandidateOption[];
}

export interface ReceiptItemMatch {
  rawLine?: string;
  nameCandidate?: string;
  brandCandidate?: string;
  sizeCandidate?: string;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
  upcCandidate?: string;
  requiresUpc?: boolean;
  lineIndex?: number;
  match?: {
    productId?: string;
    registryUpcId?: string;
    confidence?: number;
    reason?: string;
  };
  actionSuggestion?: ReceiptApprovalAction;
  warnings?: string[];
}

export interface ReceiptParseJob {
  _id: string;
  captureId: string;
  status: ReceiptParseStatus;
  createdAt: string;
  storeCandidate?: ReceiptStoreCandidate;
  items?: ReceiptItemMatch[];
  warnings?: string[];
  parseError?: string;
  parseErrorType?: 'TRANSIENT' | 'PERMANENT';
  retryAfter?: string;
  skippedImageReason?: string[];
}

export type UnmappedProductStatus = 'NEW' | 'IGNORED' | 'MAPPED';

export interface UnmappedProduct {
  _id: string;
  storeId: string;
  rawName: string;
  lastSeenRawName?: string;
  normalizedName: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  status: UnmappedProductStatus;
  mappedProductId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PriceObservation {
  _id: string;
  productId?: string;
  unmappedProductId?: string;
  storeId: string;
  price: number;
  observedAt?: string;
  receiptCaptureId?: string;
}

export interface ReceiptApprovalCreateProductPayload {
  name: string;
  price: number;
  deposit?: number;
  sizeOz?: number;
  sizeUnit?: SizeUnit;
  category?: string;
  brand?: string;
  productType?: string;
  storageZone?: string;
  storageBin?: string;
  isGlass?: boolean;
  isTaxable?: boolean;
}

export interface ReceiptApprovalDraftItem {
  lineIndex: number;
  action: ReceiptApprovalAction;
  productId?: string;
  sku?: string;
  upc?: string;
  createProduct?: ReceiptApprovalCreateProductPayload;
}

export interface ReceiptApprovalDraft {
  jobId: string;
  captureId: string;
  finalStoreMode: FinalStoreMode;
  finalStoreId?: string;
  storeCandidate?: ReceiptStoreCandidate;
  confirmStoreCreate?: boolean;
  items: ReceiptApprovalDraftItem[];
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
    // Large Order Handling
    largeOrderIncludedItems: number;
    largeOrderPerItemFee: number;
    // Heavy Item Handling
    heavyItemFeePerUnit: number;
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
  allowReceiptApprovalCreateProduct: boolean;
  priceLockDays: number;

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

/**
 * Receipt item classification buckets for workflow
 */
export type ReceiptItemClassification = 'A' | 'B' | 'C' | 'D';

export interface ReceiptItemTokens {
  brand?: string | null;
  size?: string | null;
  flavor?: string[];
}

export interface ReceiptMatchHistoryEntry {
  price: number;
  observedAt: string;
  matchMethod?: string;
  matchConfidence?: number;
  priceType?: string;
  promoDetected?: boolean;
  workflowType?: string;
}

export interface ClassifiedReceiptItem {
  receiptName: string;
  normalizedName?: string;
  quantity: number;
  totalPrice: number;
  unitPrice: number;
  classification: ReceiptItemClassification;
  reason: string;
  tokens?: ReceiptItemTokens;
  priceDelta?: number;
  matchHistory?: ReceiptMatchHistoryEntry[];
  suggestedProduct?: {
    id: string;
    name: string;
    upc?: string;
    sku?: string;
  };
  matchConfidence?: number;
  matchMethod?: string;
  workflowType?: string;
  isNoiseRule?: boolean;
  scannedUpc?: string;
  lineIndex?: number;
  captureId?: string;
}

/**
 * Parsed receipt data after Gemini extraction
 */
export interface ParsedReceipt {
  storeId?: string;
  storeName?: string;
  imageUrl: string;
  publicId: string;
  items: ClassifiedReceiptItem[];
  bucketCounts: {
    A: number; // Auto-update OK
    B: number; // Needs review
    C: number; // No match
    D: number; // Noise / non-product
  };
  parsedAt: string;
}
