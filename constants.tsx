
import React from 'react';
import { 
  Package, 
  Truck, 
  ShieldCheck, 
  ShoppingCart, 
  TrendingUp, 
  Zap, 
  Star, 
  Award, 
  Crown,
  Medal
} from 'lucide-react';
import { Product, LoyaltyReward } from './types';

export const CATEGORIES = ['Snacks', 'Drinks', 'Candy', 'Essentials', 'Outlet'];

export const ROLE_ICONS = {
  CUSTOMER: <ShoppingCart className="w-5 h-5" />,
  DRIVER: <Truck className="w-5 h-5" />,
  ADMIN: <ShieldCheck className="w-5 h-5" />,
  OWNER: <TrendingUp className="w-5 h-5" />
};

export const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'Zesty Lime Soda', price: 2.50, deposit: 0.10, category: 'Drinks', stock: 50, image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=400&q=80' },
  { id: '2', name: 'Kettle Chips - Sea Salt', price: 3.25, deposit: 0, category: 'Snacks', stock: 120, image: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=400&q=80' },
  { id: '3', name: 'Gummy Bears Party Pack', price: 4.00, deposit: 0, category: 'Candy', stock: 85, image: 'https://images.unsplash.com/photo-1582050041567-9cfdd330d545?auto=format&fit=crop&w=400&q=80' },
  { id: '4', name: 'Sparkling Mineral Water (Glass)', price: 1.75, deposit: 0.10, category: 'Drinks', stock: 200, image: 'https://images.unsplash.com/photo-1551731589-22240b86e68f?auto=format&fit=crop&w=400&q=80', isGlass: true },
  { id: '5', name: 'Spicy Beef Jerky', price: 6.99, deposit: 0, category: 'Snacks', stock: 45, image: 'https://images.unsplash.com/photo-1543353071-097079c19b0d?auto=format&fit=crop&w=400&q=80' },
  // Used Items
  { id: 'u1', name: 'Insulated Delivery Cooler', price: 15.00, deposit: 0, category: 'Outlet', stock: 3, image: 'https://images.unsplash.com/photo-1583258292688-d0213dc5a3a8?auto=format&fit=crop&w=400&q=80', isUsed: true, condition: 'Grade A - Excellent' },
  { id: 'u2', name: 'Steel Bottle Display Rack', price: 25.00, deposit: 0, category: 'Outlet', stock: 1, image: 'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?auto=format&fit=crop&w=400&q=80', isUsed: true, condition: 'Minor Scratches' },
  { id: 'u3', name: 'Rechargeable LED Lantern', price: 8.50, deposit: 0, category: 'Outlet', stock: 12, image: 'https://images.unsplash.com/photo-1517333348871-364566482ff5?auto=format&fit=crop&w=400&q=80', isUsed: true, condition: 'Like New' },
];

export const MOCK_REWARDS: LoyaltyReward[] = [
  { id: 'r1', title: 'Free Delivery', description: 'Waive the delivery fee on your next order.', cost: 500, type: 'PERK' },
  { id: 'r2', title: 'Snack Credit', description: '$2.00 credit applied to your balance.', cost: 1200, type: 'CREDIT', value: 2.00 },
  { id: 'r3', title: 'Premium Credit', description: '$5.00 credit applied to your balance.', cost: 2500, type: 'CREDIT', value: 5.00 },
  { id: 'r4', title: 'Elite Rewards', description: 'Exclusive Ninpo Snacks Merch + $10 credit.', cost: 5000, type: 'CREDIT', value: 10.00 },
];

export const LOYALTY_TIERS = [
  { name: 'Bronze', minXP: 0, icon: <Zap className="w-4 h-4" /> },
  { name: 'Silver', minXP: 1000, icon: <Medal className="w-4 h-4" /> },
  { name: 'Gold', minXP: 3000, icon: <Award className="w-4 h-4" /> },
  { name: 'Platinum', minXP: 7000, icon: <Crown className="w-4 h-4" /> },
];

export const MOCK_USER = {
  id: 'custo_001',
  name: 'Alex Johnson',
  email: 'alex@customail.com',
  role: 'CUSTO',
  credits: 24.50,
  referralCode: 'CUSTO77',
  loyaltyPoints: 1250,
  dailyReturnTotal: 0,
  redeemedRewards: []
};
