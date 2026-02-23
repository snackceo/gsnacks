import { recordAuditLog } from '../audit.js';

const RECEIPT_SKIP_ROW_PATTERN = /(subtotal|sub total|tax|payment|tender|change|balance|total\s+due|grand\s+total|cash|credit|debit|visa|mastercard|amex|discover|coupon|discount|savings|loyalty|fee|deposit|bottle\s+return|tip|auth|approval|invoice|order\s*#|thank\s+you)/i;

const RECEIPT_IMAGE_FETCH_ATTEMPTS = 3;
const RECEIPT_IMAGE_FETCH_RETRY_DELAY_MS = 300;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const normalizeSpacedDecimalTokens = value => {
  if (!value) return value;
  return String(value)
    .replace(/(\d)\s+(\d)/g, '$1$2')
    .replace(/(\d)\s+([.,])/g, '$1$2')
    .replace(/([.,])\s+(\d)/g, '$1$2');
};

const sanitizeNumericCandidate = raw => {
  if (raw === null || raw === undefined) return '';
  return normalizeSpacedDecimalTokens(String(raw))
    .replace(/\(([^)]+)\)/g, '-$1')
    .replace(/\b(?:USD|U5D|USO|EUR|CAD|GBP)\b/gi, '')
    .replace(/[oO]/g, '0')
    .replace(/[lI]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');
};

const normalizeSmartQuotes = value => String(value || '')
  .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
  .replace(/[\u201C\u201D\u201E\u201F]/g, '"');

const stripCodeFences = value => normalizeSmartQuotes(value)
  .replace(/```json\s*/gi, '')
  .replace(/```\s*/g, '')
  .trim();

const extractLargestJsonBlock = value => {
  const input = String(value || '');
  const spans = [];
  const stack = [];
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '{') {
      stack.push(i);
    } else if (char === '}' && stack.length) {
      const start = stack.pop();
      spans.push({ start, end: i + 1, length: i + 1 - start });
    }
  }
  if (!spans.length) return '';
  spans.sort((a, b) => b.length - a.length);
  const best = spans[0];
  return input.slice(best.start, best.end);
};

const normalizeJsonCandidate = value => {
  let normalized = stripCodeFences(value);
  const largestJsonBlock = extractLargestJsonBlock(normalized);
  if (largestJsonBlock) {
    normalized = largestJsonBlock;
  }
  return normalized
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
};

export const parseGeminiJsonPayload = rawText => {
  const firstPass = stripCodeFences(rawText);
  try {
    return JSON.parse(firstPass);
  } catch (_err) {
    const tolerant = normalizeJsonCandidate(rawText);
    if (!tolerant) return null;
    try {
      return JSON.parse(tolerant);
    } catch (_tolerantErr) {
      return null;
    }
  }
};

export const sanitizeReceiptNumber = value => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let cleaned = sanitizeNumericCandidate(value);
  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    cleaned = decimalSeparator === '.'
      ? cleaned.replace(/,/g, '')
      : cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastComma !== -1) {
    const commaCount = (cleaned.match(/,/g) || []).length;
    const parts = cleaned.split(',');
    const decimalLike = commaCount === 1 && parts[1]?.length > 0 && parts[1].length <= 2;
    cleaned = decimalLike ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (lastDot !== -1) {
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      const parts = cleaned.split('.');
      const decimalPart = parts.pop();
      cleaned = `${parts.join('')}.${decimalPart}`;
    }
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export const parseReceiptAddress = (rawAddress = '') => {
  if (!rawAddress) return {};
  const cleaned = rawAddress.trim();
  const zipMatch = cleaned.match(/\b\d{5}\b/);
  const zip = zipMatch?.[0];
  const parts = cleaned.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const street = parts[0];
    const city = parts[1];
    const stateZip = parts.slice(2).join(' ');
    const stateZipMatch = stateZip.match(/([A-Z]{2})\s*(\d{5})?/i);
    const state = stateZipMatch?.[1]?.toUpperCase();
    const parsedZip = stateZipMatch?.[2] || zip;
    return { street, city, state, zip: parsedZip };
  }
  const lines = cleaned.split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const street = lines[0];
    const locality = lines.slice(1).join(' ');
    const localityMatch = locality.match(/^(.*?)(?:\s+([A-Z]{2})\s*(\d{5})?)$/i);
    if (localityMatch) {
      return {
        street,
        city: localityMatch[1].trim(),
        state: localityMatch[2].toUpperCase(),
        zip: localityMatch[3] || zip
      };
    }
    return {
      street,
      city: locality.replace(/\b\d{5}\b/, '').trim(),
      zip
    };
  }
  return { street: cleaned, zip };
};

export const recoverItemsFromRawText = rawText => {
  const lines = String(rawText || '').split(/\r?\n/);
  const recovered = [];
  let pendingName = '';

  const itemLineRegex = /^(.+?)\s+(?:(\d+(?:[.,]\d+)?)\s*[xX]\s*)?([\$€£]?\s*[\d\s]+(?:[.,]\s*\d{1,2})?(?:\s*[A-Z]{3})?)\s*$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pendingName = '';
      continue;
    }
    if (RECEIPT_SKIP_ROW_PATTERN.test(line)) {
      pendingName = '';
      continue;
    }

    const normalizedLine = normalizeSpacedDecimalTokens(line);
    const match = normalizedLine.match(itemLineRegex);

    if (!match) {
      if (!/\d/.test(line) && line.length > 2) {
        pendingName = pendingName ? `${pendingName} ${line}` : line;
      }
      continue;
    }

    const inlineName = match[1]?.trim();
    const name = (pendingName ? `${pendingName} ${inlineName}` : inlineName).trim();
    const qty = sanitizeReceiptNumber(match[2]) || 1;
    const price = sanitizeReceiptNumber(match[3]);

    pendingName = '';
    if (!name || !price || price <= 0 || RECEIPT_SKIP_ROW_PATTERN.test(name)) {
      continue;
    }

    recovered.push({
      receiptName: name,
      quantity: qty > 0 ? qty : 1,
      totalPrice: price,
      unitPrice: qty > 0 ? price / qty : price
    });
  }

  return recovered;
};

export async function fetchAsInlineData(url) {
  let lastError;
  for (let attempt = 1; attempt <= RECEIPT_IMAGE_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`Failed to fetch receipt image: ${resp.status}`);
      }
      const contentType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0];
      const buf = Buffer.from(await resp.arrayBuffer());
      return { inlineData: { mimeType: contentType, data: buf.toString('base64') } };
    } catch (error) {
      lastError = error;
      if (attempt < RECEIPT_IMAGE_FETCH_ATTEMPTS) {
        await sleep(RECEIPT_IMAGE_FETCH_RETRY_DELAY_MS * attempt);
      }
    }
  }
  await recordAuditLog({
    type: 'receipt_parse_image_fetch_failed',
    actorId: 'worker',
    details: `url=${url} attempts=${RECEIPT_IMAGE_FETCH_ATTEMPTS} error=${lastError?.message || 'unknown'}`
  });
  throw lastError;
}

export function buildInlineDataFromDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2]
    }
  };
}
