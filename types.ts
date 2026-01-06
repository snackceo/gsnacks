
export enum UserRole {
  CUSTOMER = 'CUSTO',
  DRIVER = 'DRIVER',
  ADMIN = 'ADMIN',
  OWNER = 'OWNER'
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  credits: number;
  referralCode: string;
  loyaltyPoints: number;
  dailyReturnTotal: number;
  redeemedRewards?: string[];
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
  ASSIGNED = 'ASSIGNED',
  OUT_FOR_DELIVERY = 'DELIVERED_ON_WAY',
  ARRIVED = 'ARRIVED',
  VERIFYING_RETURNS = 'VERIFYING_RETURNS',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED'
}

export type PaymentMethod = 'CREDITS' | 'GOOGLE_PAY' | 'STRIPE_CARD' | 'BOTTLE_CREDIT';

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
  verificationPhoto?: string;
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
