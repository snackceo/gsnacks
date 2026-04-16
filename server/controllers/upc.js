import UpcItem from '../models/UpcItem.js';
import UpcLookupCache from '../models/UpcLookupCache.js';
import { resolveUpc, isValidBarcode as isValidBarcodeInternal } from '../services/upcResolutionService.js';

const normalizeContainerType = value => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'glass') return 'glass';
  if (raw === 'plastic') return 'plastic';
  if (raw === 'aluminum' || raw === 'can' || raw === 'cans') return 'aluminum';
  return undefined;
};

const coerceNumber = value => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const MICHIGAN_DEPOSIT_VALUE = 0.1;

const getMichiganDepositValue = async () => MICHIGAN_DEPOSIT_VALUE;
const OFF_FIELDS = 'code,product_name,brands,quantity,image_url,categories,ingredients_text,nutriments';
const OFF_ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';
const OFF_USER_AGENT =
  process.env.OFF_USER_AGENT ||
  'NinpoSnacksInventory/1.0 (contact: support@ninposnacks.com)';

const OFF_COOLDOWN_WINDOW_MS = 5 * 60 * 1000;
const OFF_COOLDOWN_THRESHOLD = 3;
const OFF_COOLDOWN_MS = 60 * 1000;
const offCooldownState = {
  failureCount: 0,
  lastFailureAt: 0,
  cooldownUntil: 0
};

const recordOffFailure = () => {
  const now = Date.now();
  if (now - offCooldownState.lastFailureAt > OFF_COOLDOWN_WINDOW_MS) {
    offCooldownState.failureCount = 0;
  }
  offCooldownState.failureCount += 1;
  offCooldownState.lastFailureAt = now;
  if (offCooldownState.failureCount >= OFF_COOLDOWN_THRESHOLD) {
    offCooldownState.cooldownUntil = now + OFF_COOLDOWN_MS;
  }
};

const resetOffFailures = () => {
  offCooldownState.failureCount = 0;
  offCooldownState.lastFailureAt = 0;
  offCooldownState.cooldownUntil = 0;
};

const isOffCooldownActive = () => Date.now() < offCooldownState.cooldownUntil;

const buildEligibilityPayload = (entry, depositValue) => {
  const containerType =
    normalizeContainerType(entry?.containerType) ||
    (entry?.isGlass ? 'glass' : 'plastic');
  const payload = {
    eligible: entry ? entry.isEligible !== false : false,
    depositValue: entry
      ? Number(entry.depositValue || depositValue)
      : depositValue,
    containerType,
    sizeOz: entry ? coerceNumber(entry.sizeOz) : 0,
    price: entry ? coerceNumber(entry.price) : 0
  };

  if (entry?.name) {
    payload.name = entry.name;
  }

  return payload;
};

const normalizeBarcode = value => String(value || '').replace(/\D/g, '');
const isValidBarcode = isValidBarcodeInternal;

const normalizeUpcList = value => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map(item => normalizeBarcode(item))
    .filter(Boolean);
};

const mapOffProduct = product => {
  const brands = String(product?.brands || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return {
    name: product?.product_name || '',
    brand: brands[0] || '',
    imageUrl: product?.image_url || '',
    quantity: product?.quantity || '',
    categories: product?.categories || '',
    ingredients: product?.ingredients_text || '',
    nutriments: product?.nutriments || {}
  };
};

const synchronizeContainerType = (updates) => {
  const newUpdates = { ...updates };
  if (newUpdates.containerType) {
    newUpdates.containerType = normalizeContainerType(newUpdates.containerType);
    newUpdates.isGlass = newUpdates.containerType === 'glass';
  } else if (newUpdates.isGlass !== undefined) {
    newUpdates.isGlass = !!newUpdates.isGlass;
    newUpdates.containerType = newUpdates.isGlass ? 'glass' : 'plastic';
  }
  return newUpdates;
};

export const getEligibility = async (req, res) => {
  try {
    const upc = normalizeBarcode(req.query?.upc);
    if (!upc) return res.status(400).json({ error: 'upc is required' });
    if (!isValidBarcode(upc)) {
      return res.status(400).json({ error: 'Invalid barcode format', normalizedUpc: upc });
    }
    const depositValue = await getMichiganDepositValue();
    const entry = await UpcItem.findOne({ upc }).lean();
    res.json(buildEligibilityPayload(entry, depositValue));
  } catch (err) {
    console.error('UPC ELIGIBILITY ERROR:', err);
    res.status(500).json({ error: 'Failed to check UPC eligibility' });
  }
};

export const postEligibility = async (req, res) => {
  try {
    const body = req.body;
    const upcs = normalizeUpcList(Array.isArray(body) ? body : body?.upcs);
    const depositValue = await getMichiganDepositValue();

    if (upcs.length > 0) {
      const invalidUpcs = upcs.filter(upc => !isValidBarcode(upc));
      if (invalidUpcs.length > 0) {
        return res.status(400).json({
          error: 'Invalid barcode format',
          invalidUpcs
        });
      }
      const entries = await UpcItem.find({ upc: { $in: upcs } }).lean();
      const entryMap = new Map(entries.map(entry => [entry.upc, entry]));
      const results = upcs.map(upc => ({
        upc,
        ...buildEligibilityPayload(entryMap.get(upc), depositValue)
      }));

      return res.json({ results });
    }

    const upc = normalizeBarcode(body?.upc);
    if (!upc) return res.status(400).json({ error: 'upc is required' });
    if (!isValidBarcode(upc)) {
      return res.status(400).json({ error: 'Invalid barcode format', normalizedUpc: upc });
    }

    const entry = await UpcItem.findOne({ upc }).lean();
    return res.json(buildEligibilityPayload(entry, depositValue));
  } catch (err) {
    console.error('UPC ELIGIBILITY BULK ERROR:', err);
    return res.status(500).json({ error: 'Failed to check UPC eligibility' });
  }
};

export const getOffLookup = async (req, res) => {
  try {
    // Prevent browser caching for owner-only data
    res.set({
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Vary': 'Cookie, Origin'
    });

    const code = normalizeBarcode(req.params.code);
    if (!code) return res.status(400).json({ error: 'code is required' });
    if (!isValidBarcode(code)) {
      return res.status(400).json({ error: 'Invalid barcode format', normalizedUpc: code });
    }

    if (isOffCooldownActive()) {
      return res.status(503).json({
        error: 'Open Food Facts lookup temporarily unavailable due to upstream issues.'
      });
    }

    const cached = await UpcLookupCache.findOne({ code }).lean();
    if (cached?.payload) {
      return res.json({ ok: true, cached: true, ...cached.payload });
    }

    const url = `${OFF_ENDPOINT}/${encodeURIComponent(code)}?fields=${OFF_FIELDS}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let offResponse;
    try {
      offResponse = await fetch(url, {
        headers: { 'User-Agent': OFF_USER_AGENT },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!offResponse.ok) {
      if (offResponse.status === 429 || offResponse.status >= 500) {
        recordOffFailure();
      }
      return res.status(502).json({ error: 'Open Food Facts lookup failed' });
    }

    let offData;
    try {
      offData = await offResponse.json();
    } catch (jsonError) {
      console.error('OFF LOOKUP: JSON PARSE ERROR:', jsonError);
      return res.status(502).json({ error: 'Failed to parse Open Food Facts response' });
    }
    resetOffFailures();
    const found = Boolean(offData?.status === 1 && offData?.product);
    const payload = found
      ? {
          found: true,
          code,
          product: mapOffProduct(offData.product)
        }
      : { found: false, code };

    await UpcLookupCache.findOneAndUpdate(
      { code },
      { code, payload, fetchedAt: new Date() },
      { upsert: true, setDefaultsOnInsert: true }
    );

    return res.json({ ok: true, ...payload });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'Open Food Facts lookup timed out' });
    }
    console.error('OFF LOOKUP ERROR:', err);
    return res.status(500).json({ error: 'Failed to lookup UPC' });
  }
};

export const getUpcEligibility = async (req, res) => {
  try {
    const upc = normalizeBarcode(req.params.upc);
    if (!upc) return res.status(400).json({ error: 'upc is required' });
    if (!isValidBarcode(upc)) {
      return res.status(400).json({ error: 'Invalid barcode format', normalizedUpc: upc });
    }
    const depositValue = await getMichiganDepositValue();

    const entry = await UpcItem.findOne({ upc }).lean();
    if (!entry) {
      return res.json({ ok: true, upc, isEligible: false, depositValue });
    }

    res.json({
      ok: true,
      upc,
      isEligible: entry.isEligible !== false,
      depositValue: Number(entry.depositValue || depositValue)
    });
  } catch (err) {
    console.error('UPC ELIGIBILITY ERROR:', err);
    res.status(500).json({ error: 'Failed to check UPC eligibility' });
  }
};

export const getUpcItems = async (_req, res) => {
  try {
    // Prevent browser caching for owner-only data
    res.set({
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Vary': 'Cookie, Origin'
    });

    const entries = await UpcItem.find({}).sort({ updatedAt: -1 }).lean();
    const depositValue = await getMichiganDepositValue();
    const upcItems = entries.map(entry => ({
      upc: entry.upc,
      name: entry.name || '',
      depositValue: depositValue,
      price: coerceNumber(entry.price),
      containerType:
        normalizeContainerType(entry.containerType) ||
        (entry.isGlass ? 'glass' : 'plastic'),
      sizeOz: coerceNumber(entry.sizeOz),
      isEligible: entry.isEligible !== false,
      createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined,
      updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : undefined
    }));

    res.json({ ok: true, upcItems });
  } catch (err) {
    console.error('GET UPC ERROR:', err);
    res.status(500).json({ error: 'Failed to load UPC list' });
  }
};

export const upsertUpcItem = async (req, res) => {
  try {
    const upc = normalizeBarcode(req.body?.upc);
    if (!upc) return res.status(400).json({ error: 'upc is required' });
    if (!isValidBarcode(upc)) {
      return res.status(400).json({ error: 'Invalid barcode format', normalizedUpc: upc });
    }
    const depositValue = await getMichiganDepositValue();

    let updates = {
      upc,
      name: req.body?.name ?? '',
      depositValue: depositValue,
      sku: req.body?.sku ? String(req.body.sku).trim() : undefined,
      price: coerceNumber(req.body?.price),
      containerType: normalizeContainerType(req.body?.containerType),
      sizeOz: coerceNumber(req.body?.sizeOz),
      isEligible: req.body?.isEligible !== false
    };
    if (req.body.isGlass !== undefined) updates.isGlass = req.body.isGlass;
    updates = synchronizeContainerType(updates);

    const entry = await UpcItem.findOneAndUpdate({ upc }, updates, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }).lean();

    res.json({
      ok: true,
      upcItem: {
        upc: entry.upc,
        sku: entry.sku || undefined,
        name: entry.name || '',
        depositValue: depositValue,
        price: coerceNumber(entry.price),
        containerType:
          normalizeContainerType(entry.containerType) ||
          (entry.isGlass ? 'glass' : 'plastic'),
        sizeOz: coerceNumber(entry.sizeOz),
        isEligible: entry.isEligible !== false,
        createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined,
        updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : undefined
      }
    });
  } catch (err) {
    console.error('UPSERT UPC ERROR:', err);
    res.status(500).json({ error: 'Failed to save UPC' });
  }
};

export const scanUpc = async (req, res) => {
  try {
    const { upc, resolveOnly } = req.body;
    const normalizedUpc = normalizeBarcode(upc);
    if (!normalizedUpc) return res.status(400).json({ error: 'upc is required' });
    if (!isValidBarcode(normalizedUpc)) {
      return res.status(400).json({ error: 'Invalid barcode format', normalizedUpc });
    }

    const { product, upcEntry, action } = await resolveUpc(normalizedUpc);

    if (action === 'resolved' && product) {
      if (resolveOnly) {
        return res.json({ ok: true, action: 'resolved', product, upcEntry });
      }
      const updated = await Product.findOneAndUpdate({ sku: upcEntry.sku }, { $inc: { stock: qty } }, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: 'Mapped product not found' });
      return res.json({ ok: true, action: 'updated', product: updated });
    }

    return res.json({ ok: true, action, upc: normalizedUpc, upcEntry });
  } catch (err) {
    console.error('UPC SCAN ERROR:', err);
    res.status(500).json({ error: 'Failed to apply UPC scan' });
  }
};

export const linkUpc = async (req, res) => {
  try {
    const { productId } = req.body;
    const upc = normalizeBarcode(req.body?.upc);
    if (!upc || !productId) {
      return res.status(400).json({ error: 'upc and productId are required' });
    }
    if (!isValidBarcode(upc)) {
      return res.status(400).json({ error: 'Invalid barcode format', normalizedUpc: upc });
    }

    const upcEntry = await UpcItem.findOneAndUpdate(
      { upc },
      { sku: productId },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ ok: true, upcEntry });
  } catch (err) {
    console.error('UPC LINK ERROR:', err);
    res.status(500).json({ error: 'Failed to link UPC' });
  }
};

export const patchUpcItem = async (req, res) => {
  try {
    const upc = normalizeBarcode(req.params.upc);
    if (!upc) return res.status(400).json({ error: 'upc is required' });
    if (!isValidBarcode(upc)) {
      return res.status(400).json({ error: 'Invalid barcode format', normalizedUpc: upc });
    }
    const depositValue = await getMichiganDepositValue();

    const updates = {};
    const allowed = [
      'name',
      'price',
      'containerType',
      'sizeOz',
      'isGlass',
      'isEligible'
    ];
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }

    let processedUpdates = { ...updates };
    if (updates.price !== undefined) updates.price = coerceNumber(updates.price);
    if (updates.sizeOz !== undefined) updates.sizeOz = coerceNumber(updates.sizeOz);
    if (updates.isEligible !== undefined) updates.isEligible = !!updates.isEligible;

    processedUpdates = synchronizeContainerType(processedUpdates);

    const entry = await UpcItem.findOneAndUpdate({ upc }, processedUpdates, {
      new: true
    }).lean();

    if (!entry) return res.status(404).json({ error: 'UPC not found' });

    res.json({
      ok: true,
      upcItem: {
        upc: entry.upc,
        name: entry.name || '',
        depositValue: depositValue,
        price: coerceNumber(entry.price),
        containerType:
          normalizeContainerType(entry.containerType) ||
          (entry.isGlass ? 'glass' : 'plastic'),
        sizeOz: coerceNumber(entry.sizeOz),
        isEligible: entry.isEligible !== false,
        createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined,
        updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : undefined
      }
    });
  } catch (err) {
    console.error('PATCH UPC ERROR:', err);
    res.status(500).json({ error: 'Failed to update UPC' });
  }
};

export const deleteUpcItem = async (req, res) => {
  try {
    const upc = normalizeBarcode(req.params.upc);
    if (!upc) return res.status(400).json({ error: 'upc is required' });
    if (!isValidBarcode(upc)) {
      return res.status(400).json({ error: 'Invalid barcode format', normalizedUpc: upc });
    }

    const deleted = await UpcItem.findOneAndDelete({ upc }).lean();
    if (!deleted) return res.status(404).json({ error: 'UPC not found' });

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE UPC ERROR:', err);
    res.status(500).json({ error: 'Failed to delete UPC' });
  }
};