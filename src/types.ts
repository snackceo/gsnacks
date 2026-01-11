export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  OWNER = 'OWNER'
}

export enum OrderStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  ASSIGNED = 'ASSIGNED',
  PICKED_UP = 'PICKED_UP',
  ARRIVING = 'ARRIVING',
  DELIVERED = 'DELIVERED',
  REFUND_REQUESTED = 'REFUND_REQUESTED',
  REFUNDED = 'REFUNDED',
  CLOSED = 'CLOSED'
}

export type PaymentMethod = 'STRIPE_CARD' | 'GOOGLE_PAY';

export enum UserTier {
  NONE = 'NONE',
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM'
}

export interface User {
  id: string;
  name?: string;
  username?: string;
  role: UserRole;
  creditBalance: number;
  loyaltyPoints?: number;
  membershipTier: UserTier;
  createdAt?: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  deposit: number;
  stock: number;
  category: string;
  image: string;
  isGlass: boolean;
}

export interface UpcItem {
  upc: string;
  name: string;
  depositValue: number;
  isGlass: boolean;
  isEligible: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Order {
  id: string;
  customerId: string;
  driverId?: string;
  items: { productId: string; quantity: number }[];
  total: number;
  estimatedReturnCredit: number;
  verifiedReturnCredit?: number;
  returnUpcs?: string[];
  verifiedReturnUpcs?: string[];

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
  gpsCoords?: { lat: number; lng: number };
}

export interface AppSettings {
  michiganDepositValue: number;
  dailyReturnLimit: number;
  requirePhotoForRefunds: boolean;
  allowGuestCheckout: boolean;
  showAdvancedInventoryInsights: boolean;
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
