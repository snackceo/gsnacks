
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
  dailyReturnTotal: number; // Tracking the $25/day Michigan limit
  redeemedRewards?: string[]; // IDs of rewards already claimed
}

export interface Product {
  id: string;
  name: string;
  price: number;
  deposit: number;
  category: string;
  stock: number;
  image: string;
  isGlass?: boolean; // Flag for glass handling fees
  isUsed?: boolean; // New: Flag for used/pre-owned items
  condition?: string; // New: Description of used item condition
}

export enum OrderStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  OUT_FOR_DELIVERY = 'DELIVERED_ON_WAY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED'
}

export interface Order {
  id: string;
  customerId: string;
  driverId?: string;
  items: { productId: string; quantity: number }[];
  total: number;
  status: OrderStatus;
  createdAt: string;
  trackingLocation?: { lat: number; lng: number };
  verificationPhoto?: string;
}

export interface AppSettings {
  deliveryFee: number;
  referralBonus: number;
  michiganDepositValue: number; // 0.10
  processingFeePercent: number; // 0.20
  glassHandlingFeePercent: number; // Handling fee as a percentage (e.g. 0.05)
  dailyReturnLimit: number; // 25.00
  maintenanceMode: boolean;
}

export interface LoyaltyReward {
  id: string;
  title: string;
  description: string;
  cost: number;
  type: 'CREDIT' | 'DISCOUNT' | 'PERK';
  value?: number;
}
