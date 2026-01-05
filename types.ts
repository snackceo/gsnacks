
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
}

export interface Product {
  id: string;
  name: string;
  price: number;
  deposit: number;
  category: string;
  stock: number;
  image: string;
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
  glassHandlingFee: number; // 0.15 suggested
  dailyReturnLimit: number; // 25.00
  maintenanceMode: boolean;
}
