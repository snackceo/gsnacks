
import { Product } from './types';

export const CATEGORIES = ['SNACKS', 'DRINKS', 'CANDY', 'ESSENTIALS', 'OUTLET'];

export const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'PREMIUM WASABI PEAS', price: 4.50, deposit: 0, category: 'SAVORY', stock: 50, image: 'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&w=400&q=80' },
  { id: '2', name: 'ARTISAN MOCHI', price: 6.99, deposit: 0, category: 'SWEET', stock: 20, image: 'https://images.unsplash.com/photo-1596797038530-2c391b0ff45e?auto=format&fit=crop&w=400&q=80' },
  { id: '3', name: 'MATCHA STICKS', price: 3.25, deposit: 0, category: 'SWEET', stock: 100, image: 'https://images.unsplash.com/photo-1591871937573-74dbba515c4c?auto=format&fit=crop&w=400&q=80' },
  { id: '4', name: 'ORGANIC SEAWEED', price: 2.99, deposit: 0, category: 'HEALTHY', stock: 75, image: 'https://images.unsplash.com/photo-1590487988256-9ed24133863e?auto=format&fit=crop&w=400&q=80' },
  { id: '5', name: 'RAMUNE SODA', price: 3.50, deposit: 0.10, category: 'DRINK', stock: 40, image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=400&q=80' },
];

export const MOCK_USER = {
  id: 'custo_001',
  name: 'ALEX JOHNSON',
  email: 'alex@customail.com',
  role: 'CUSTO',
  credits: 24.50,
  referralCode: 'CUSTO77',
  loyaltyPoints: 1250,
  dailyReturnTotal: 0,
};
