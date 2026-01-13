
import { Product } from './types';

export const CATEGORIES = ['ALL', 'SAVORY', 'SWEET', 'DRINK', 'HEALTHY', 'USED GEAR'];

export const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'NINPO WASABI PEAS', price: 4.50, deposit: 0, stock: 50, sizeOz: 0, category: 'SAVORY', image: 'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&w=400&q=80', isGlass: false },
  { id: '2', name: 'KYOTO MATCHA MOCHI', price: 6.99, deposit: 0, stock: 20, sizeOz: 0, category: 'SWEET', image: 'https://images.unsplash.com/photo-1596797038530-2c391b0ff45e?auto=format&fit=crop&w=400&q=80', isGlass: false },
  { id: '3', name: 'SEA SALT POCKY STICKS', price: 3.25, deposit: 0, stock: 100, sizeOz: 0, category: 'SWEET', image: 'https://images.unsplash.com/photo-1591871937573-74dbba515c4c?auto=format&fit=crop&w=400&q=80', isGlass: false },
  { id: '4', name: 'ORGANIC NORI CRISPS', price: 2.99, deposit: 0, stock: 75, sizeOz: 0, category: 'HEALTHY', image: 'https://images.unsplash.com/photo-1590487988256-9ed24133863e?auto=format&fit=crop&w=400&q=80', isGlass: false },
  { id: '5', name: 'RAMUNE SODA CLASSIC', price: 3.50, deposit: 0.10, stock: 40, sizeOz: 12, category: 'DRINK', image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=400&q=80', isGlass: true },
  { id: '6', name: 'CALPICO MELON BLEND', price: 3.75, deposit: 0.10, stock: 35, sizeOz: 16.9, category: 'DRINK', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=400&q=80', isGlass: false },
  { id: '7', name: 'NINPO LOGO HOODIE', price: 45.00, deposit: 0, stock: 5, sizeOz: 0, category: 'USED GEAR', image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=400&q=80', isGlass: false },
  { id: '8', name: 'TACTICAL GEAR BOTTLE', price: 18.50, deposit: 0, stock: 8, sizeOz: 24, category: 'USED GEAR', image: 'https://images.unsplash.com/photo-1602143399827-72149dc88702?auto=format&fit=crop&w=400&q=80', isGlass: false },
];
