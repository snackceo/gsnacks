
export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  DRIVER = 'DRIVER',
  OWNER = 'OWNER'
}

export enum UserTier {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD'
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tier: UserTier;
  credits: number;
  referralCode: string;
  referredBy?: string;
  loyaltyPoints: number;
  dailyReturnTotal: number;
  acceptedPoliciesAt?: string;
  isLocked?: boolean;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  deposit: number;
  category: string;
  stock: number;
  image: string;
  isGlass?: boolean;
}

export enum OrderStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  ASSIGNED = 'ASSIGNED',
  PICKED_UP = 'PICKED_UP',
  ARRIVING = 'ARRIVING',
  DELIVERED = 'DELIVERED',
  CLOSED = 'CLOSED',
  REFUNDED = 'REFUNDED'
}

export type PaymentMethod = 'CREDITS' | 'GOOGLE_PAY' | 'STRIPE_CARD';

export interface Order {
  id: string;
  customerId: string;
  driverId?: string;
  items: { productId: string; quantity: number }[];
  total: number;
  estimatedReturnCredit: number;
  verifiedReturnCredit?: number;
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

export interface ApprovalRequest {
  id: string;
  type: 'REFUND' | 'BOTTLE_RETURN';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  userId: string;
  orderId?: string;
  amount: number;
  photoProof?: string;
  createdAt: string;
  processedAt?: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  metadata: any;
  timestamp: string;
}

export interface AppSettings {
  deliveryFee: number;
  referralBonus: number;
  michiganDepositValue: number;
  processingFeePercent: number;
  glassHandlingFeePercent: number;
  dailyReturnLimit: number;
  maintenanceMode: boolean;
}
