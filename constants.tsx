
import React from 'react';
import { 
  Package, 
  Truck, 
  Settings, 
  ShieldCheck, 
  ShoppingCart, 
  Recycle, 
  CreditCard, 
  TrendingUp, 
  Users,
  Box,
  Gift,
  Search,
  LayoutDashboard
} from 'lucide-react';

export const CATEGORIES = ['Snacks', 'Drinks', 'Candy', 'Essentials'];

export const ROLE_ICONS = {
  CUSTOMER: <ShoppingCart className="w-5 h-5" />,
  DRIVER: <Truck className="w-5 h-5" />,
  ADMIN: <ShieldCheck className="w-5 h-5" />,
  OWNER: <TrendingUp className="w-5 h-5" />
};

export const MOCK_PRODUCTS = [
  { id: '1', name: 'Zesty Lime Soda', price: 2.50, deposit: 0.10, category: 'Drinks', stock: 50, image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=400&q=80' },
  { id: '2', name: 'Kettle Chips - Sea Salt', price: 3.25, deposit: 0, category: 'Snacks', stock: 120, image: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=400&q=80' },
  { id: '3', name: 'Gummy Bears Party Pack', price: 4.00, deposit: 0, category: 'Candy', stock: 85, image: 'https://images.unsplash.com/photo-1582050041567-9cfdd330d545?auto=format&fit=crop&w=400&q=80' },
  { id: '4', name: 'Sparkling Mineral Water (Glass)', price: 1.75, deposit: 0.10, category: 'Drinks', stock: 200, image: 'https://images.unsplash.com/photo-1551731589-22240b86e68f?auto=format&fit=crop&w=400&q=80' },
  { id: '5', name: 'Spicy Beef Jerky', price: 6.99, deposit: 0, category: 'Snacks', stock: 45, image: 'https://images.unsplash.com/photo-1543353071-097079c19b0d?auto=format&fit=crop&w=400&q=80' },
];

export const MOCK_USER = {
  id: 'custo_001',
  name: 'Alex Johnson',
  email: 'alex@customail.com',
  role: 'CUSTO',
  credits: 24.50,
  referralCode: 'CUSTO77',
  loyaltyPoints: 1250,
  dailyReturnTotal: 0
};
