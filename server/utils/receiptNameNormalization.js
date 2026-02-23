const SIZE_UNITS = ['oz', 'ml', 'l', 'lb', 'g', 'kg', 'ct', 'pk', 'pack'];
const NOISE_TOKENS = new Set(['cookie', 'cookies']);
const SIZE_UNIT_PATTERN = SIZE_UNITS.join('|');

export const normalizeReceiptProductName = value => {
  const raw = String(value || '').toLowerCase();
  if (!raw) return '';

  const withoutPunctuation = raw
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!withoutPunctuation) return '';

  return withoutPunctuation
    .split(' ')
    .filter(token => token && !NOISE_TOKENS.has(token))
    .join(' ')
    .replace(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s+(${SIZE_UNIT_PATTERN})\\b`, 'g'), '$1$2')
    .replace(new RegExp(`\\b(\\d+(?:\\.\\d+)?)(${SIZE_UNIT_PATTERN})\\b`, 'g'), '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
};

export default normalizeReceiptProductName;
