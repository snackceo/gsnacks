

import { Product } from './types';

export const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

export const CATEGORIES = ['ALL', 'Water', 'Soda', 'Sparkling Water', 'Juice', 'Energy Drinks', 'Snacks', 'Candy', 'Condiments & Sauces', 'Coffee & Tea'];

export const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'PURIFIED WATER BOTTLE', price: 2.50, deposit: 0.05, stock: 150, sizeOz: 16.9, category: 'Water', image: '', isGlass: false },
  { id: '2', name: 'RAMUNE ORIGINAL SODA', price: 3.50, deposit: 0.10, stock: 40, sizeOz: 12, category: 'Soda', image: '', isGlass: true },
  { id: '3', name: 'PERRIER SPARKLING WATER', price: 3.99, deposit: 0.10, stock: 60, sizeOz: 11, category: 'Sparkling Water', image: '', isGlass: true },
  { id: '4', name: 'MANGO JUICE NECTAR', price: 4.25, deposit: 0, stock: 35, sizeOz: 16, category: 'Juice', image: '', isGlass: false },
  { id: '5', name: 'RED BULL ENERGY DRINK', price: 3.99, deposit: 0, stock: 55, sizeOz: 8.4, category: 'Energy Drinks', image: '', isGlass: false },
  { id: '6', name: 'WASABI PEAS SNACK', price: 4.50, deposit: 0, stock: 50, sizeOz: 0, category: 'Snacks', image: '', isGlass: false },
  { id: '7', name: 'JAPANESE HARD CANDY', price: 5.99, deposit: 0, stock: 45, sizeOz: 0, category: 'Candy', image: '', isGlass: false },
  { id: '8', name: 'SRIRACHA SAUCE 8OZ', price: 6.50, deposit: 0, stock: 30, sizeOz: 8, category: 'Condiments & Sauces', image: '', isGlass: false },
  { id: '9', name: 'MATCHA GREEN TEA POWDER', price: 12.99, deposit: 0, stock: 20, sizeOz: 2, category: 'Coffee & Tea', image: '', isGlass: false },
];

export const SKU_FORMAT = /^NP-\d{6}$/;

export const RECEIPT_STATUSES = {
  PENDING_PARSE: 'pending_parse',
  PARSING: 'parsing',
  PARSED: 'parsed',
  NEEDS_REVIEW: 'needs_review',
  FAILED: 'failed',
  COMMITTED: 'committed',
} as const;

export const SCANNER_MODES = [
  'INVENTORY_CREATE',
  'UPC_LOOKUP',
  'DRIVER_VERIFY_CONTAINERS',
  'DRIVER_FULFILL_ORDER',
  'CUSTOMER_RETURN_SCAN',
] as const;
