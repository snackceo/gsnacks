import type { SizeUnit, UpcContainerType } from '../../types';

export const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';
export const SETTINGS_STORAGE_KEY = 'ninpo:settings';
export const UPC_CONTAINER_LABELS: Record<UpcContainerType, string> = {
  aluminum: 'CAN / ALUMINUM',
  glass: 'GLASS / BOTTLE',
  plastic: 'PLASTIC / BOTTLE'
};
export const SIZE_UNIT_OPTIONS: SizeUnit[] = ['oz', 'fl oz', 'g', 'kg', 'ml', 'l'];
export const OFF_LOOKUP_FALLBACK_MESSAGE =
  'Open Food Facts lookup failed. Please fill details manually.';
export const OFF_NUTRITION_FIELDS: Array<{ key: string; label: string; unit?: string }> = [
  { key: 'energy-kcal_100g', label: 'Energy', unit: 'kcal' },
  { key: 'fat_100g', label: 'Fat', unit: 'g' },
  { key: 'carbohydrates_100g', label: 'Carbohydrates', unit: 'g' },
  { key: 'proteins_100g', label: 'Protein', unit: 'g' },
  { key: 'sugars_100g', label: 'Sugars', unit: 'g' },
  { key: 'salt_100g', label: 'Salt', unit: 'g' }
];
export const DEFAULT_NEW_PRODUCT = {
  id: '',
  name: '',
  price: 0,
  deposit: 0,
  stock: 0,
  sizeOz: 0,
  sizeUnit: 'oz' as SizeUnit,
  category: 'DRINK',
  brand: '',
  productType: '',
  nutritionNote: '',
  storageZone: '',
  storageBin: '',
  image: '',
  isGlass: false
};
