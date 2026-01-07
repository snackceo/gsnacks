
import { Product } from './types';

export const CATEGORIES = ['ALL', 'SAVORY', 'SWEET', 'DRINK', 'HEALTHY', 'USED GEAR'];

export const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'NINPO WASABI PEAS', price: 4.50, deposit: 0, category: 'SAVORY', stock: 50, image: 'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&w=400&q=80' },
  { id: '2', name: 'KYOTO MATCHA MOCHI', price: 6.99, deposit: 0, category: 'SWEET', stock: 20, image: 'https://images.unsplash.com/photo-1596797038530-2c391b0ff45e?auto=format&fit=crop&w=400&q=80' },
  { id: '3', name: 'SEA SALT POCKY STICKS', price: 3.25, deposit: 0, category: 'SWEET', stock: 100, image: 'https://images.unsplash.com/photo-1591871937573-74dbba515c4c?auto=format&fit=crop&w=400&q=80' },
  { id: '4', name: 'ORGANIC NORI CRISPS', price: 2.99, deposit: 0, category: 'HEALTHY', stock: 75, image: 'https://images.unsplash.com/photo-1590487988256-9ed24133863e?auto=format&fit=crop&w=400&q=80' },
  { id: '5', name: 'RAMUNE SODA CLASSIC', price: 3.50, deposit: 0.10, category: 'DRINK', stock: 40, image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=400&q=80', isGlass: true },
  { id: '6', name: 'CALPICO MELON BLEND', price: 3.75, deposit: 0.10, category: 'DRINK', stock: 35, image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=400&q=80', isGlass: false },
  { id: '7', name: 'NINPO LOGO HOODIE', price: 45.00, deposit: 0, category: 'USED GEAR', stock: 5, image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=400&q=80' },
  { id: '8', name: 'TACTICAL GEAR BOTTLE', price: 18.50, deposit: 0, category: 'USED GEAR', stock: 8, image: 'https://images.unsplash.com/photo-1602143399827-72149dc88702?auto=format&fit=crop&w=400&q=80' },
];
