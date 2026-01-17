import type { ReturnUpcCount, SizeUnit, User } from '../../types';
import { OFF_NUTRITION_FIELDS } from './constants';

export type OffLookupProduct = {
  name?: string;
  brand?: string;
  imageUrl?: string;
  quantity?: string;
  categories?: string;
  ingredients?: string;
  nutriments?: Record<string, number | string>;
};

export const formatOffNutrimentValue = (
  value: number | string | undefined | null,
  unit?: string
) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  const rendered = Number.isFinite(parsed)
    ? parsed.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : String(value).trim();
  const suffix = unit ? ` ${unit}` : '';
  return `${rendered}${suffix}`;
};

export const getOffNutritionEntries = (nutriments?: OffLookupProduct['nutriments']) =>
  OFF_NUTRITION_FIELDS.map(({ key, label, unit }) => {
    const displayValue = formatOffNutrimentValue(nutriments?.[key], unit);
    return displayValue ? { label, value: displayValue } : null;
  }).filter((entry): entry is { label: string; value: string } => Boolean(entry));

export const parseOffQuantity = (quantity?: string) => {
  if (!quantity) return null;
  const normalized = String(quantity).trim();
  const multiPackMatch = normalized.match(
    /(\d+)\s*[x×]\s*([\d.,]+)\s*([a-zA-Z]+(?:\s?[a-zA-Z]+)?)/i
  );
  const match = multiPackMatch ?? normalized.match(/([\d.,]+)\s*([a-zA-Z]+(?:\s?[a-zA-Z]+)?)/);
  if (!match) return null;
  const packCount = multiPackMatch ? Number(match[1]) : 1;
  const value = Number(String(match[multiPackMatch ? 2 : 1]).replace(',', '.'));
  if (!Number.isFinite(value) || !Number.isFinite(packCount) || packCount <= 0) return null;
  const rawUnit = match[multiPackMatch ? 3 : 2].toLowerCase().replace(/\./g, '').trim();
  const unitMap: Record<string, SizeUnit> = {
    oz: 'oz',
    ounce: 'oz',
    ounces: 'oz',
    floz: 'fl oz',
    'fl oz': 'fl oz',
    'fluid oz': 'fl oz',
    g: 'g',
    gram: 'g',
    grams: 'g',
    kg: 'kg',
    kilogram: 'kg',
    kilograms: 'kg',
    ml: 'ml',
    milliliter: 'ml',
    milliliters: 'ml',
    l: 'l',
    liter: 'l',
    liters: 'l'
  };
  const normalizedUnit = unitMap[rawUnit] ?? null;
  if (!normalizedUnit) return null;
  // For multi-pack strings like "6 x 12 oz", interpret as total size (72 oz).
  return { size: value * packCount, unit: normalizedUnit as SizeUnit };
};

export const buildNutritionNoteFromOff = (
  ingredients?: string,
  nutriments?: OffLookupProduct['nutriments']
) => {
  const parts: string[] = [];
  if (ingredients) {
    parts.push(`Ingredients: ${ingredients}`);
  }

  if (nutriments) {
    const nutritionBits = getOffNutritionEntries(nutriments).map(entry => `${entry.label}: ${entry.value}`);
    if (nutritionBits.length > 0) {
      parts.push(`Nutrition (per 100g): ${nutritionBits.join(', ')}`);
    }
  }

  return parts.join(' • ');
};

export const fmtTime = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

export const fmtDelta = (value: number) => {
  const normalized = Number(value || 0);
  const formatted = Math.abs(normalized).toLocaleString(undefined, {
    maximumFractionDigits: 2
  });
  return `${normalized >= 0 ? '+' : '-'}${formatted}`;
};

export const getTierStyles = (tier: string) => {
  switch (tier) {
    case 'COMMON':
      return 'border-slate-500/40 bg-slate-800/30 text-slate-300';
    case 'SILVER':
      return 'border-slate-300/40 bg-slate-400/20 text-slate-200';
    case 'GOLD':
      return 'border-yellow-400/40 bg-yellow-500/20 text-yellow-200';
    case 'PLATINUM':
      return 'border-indigo-400/40 bg-indigo-500/20 text-indigo-200';
    case 'BRONZE':
    default:
      return 'border-amber-500/40 bg-amber-700/30 text-amber-200';
  }
};

export const countTotalUpcs = (entries: ReturnUpcCount[]) =>
  entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);

export const formatSize = (value: number, unit?: SizeUnit) => {
  if (!value) return 'No size';
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return 'No size';
  const label = unit || 'oz';
  const decimals = label === 'oz' || label === 'fl oz' ? 1 : 0;
  return `${normalized.toFixed(decimals)} ${label}`;
};

export const isNewSignupWithBonus = (user: User) => {
  const createdAt = user.createdAt ? new Date(user.createdAt) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
  const ageMs = Date.now() - createdAt.getTime();
  return Number(user.loyaltyPoints || 0) >= 100 && ageMs < 24 * 60 * 60 * 1000;
};

export const shouldFillText = (current: string, next?: string) => {
  const trimmed = current.trim();
  if (trimmed) return current;
  return next ? next : current;
};

export const shouldFillNumber = (current: number, next?: number) => {
  if (Number.isFinite(current) && current > 0) return current;
  if (Number.isFinite(next) && Number(next) > 0) return Number(next);
  return current;
};
