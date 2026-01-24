import express from 'express';
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import Store from '../models/Store.js';
import AppSettings from '../models/AppSettings.js';
import StoreInventory from '../models/StoreInventory.js';
import Product from '../models/Product.js';
import UpcItem from '../models/UpcItem.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';

const router = express.Router();

const DEFAULT_PRICE_LOCK_DAYS = 7;

const getGeminiApiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

const parseJsonObject = raw => {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
};

const coerceNumber = value => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toStoreResponse = store => ({
  id: store._id.toString(),
  name: store.name,
  phone: store.phone,
  address: store.address,
  storeType: store.storeType,
  createdFrom: store.createdFrom,
  createdAt: store.createdAt ? new Date(store.createdAt).toISOString() : undefined,
  location: store.location,
  isPrimarySupplier: store.isPrimarySupplier
});

// Enrich store details using Gemini (normalize address + store type)
router.post('/enrich', authRequired, async (req, res) => {
  const { text = '', name = '', address = {} } = req.body || {};
  const input = [text, name, address.street, address.city, address.state, address.zip, address.country]
    .filter(Boolean)
    .join(', ')
    .trim();

  if (!input) {
    return res.status(400).json({ error: 'Provide store text or address to enrich.' });
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return res.status(503).json({ error: 'Gemini API key missing. Set GEMINI_API_KEY.' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You normalize store details. Respond with JSON only (no markdown). Schema:
{
  "name": string,
  "address": {
    "street": string,
    "city": string,
    "state": string,
    "zip": string,
    "country": string
  },
  "storeType": "walmart"|"kroger"|"aldi"|"target"|"meijer"|"hub"|"other",
  "location": {"lat": number, "lng": number}
}

Rules:
- Always fill street/city/state/zip/country if possible; leave empty strings if unknown.
- If unknown type, set storeType="other".
- If you infer coordinates, include them; otherwise omit.
Input:
${input}`;

    const aiResp = await ai.models.generateContent({
      model: process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash',
      contents: prompt,
      generationConfig: { temperature: 0.15 }
    });

    const textResponse = aiResp?.text?.trim?.() || aiResp?.response?.text?.() || '';
    const parsed = parseJsonObject(textResponse);
    if (!parsed) {
      return res.status(502).json({ error: 'Gemini response not understood.' });
    }

    const normalized = {
      name: String(parsed.name || name || '').trim(),
      address: {
        street: String(parsed.address?.street || address.street || '').trim(),
        city: String(parsed.address?.city || address.city || '').trim(),
        state: String(parsed.address?.state || address.state || '').trim(),
        zip: String(parsed.address?.zip || address.zip || '').trim(),
        country: String(parsed.address?.country || address.country || '').trim()
      },
      storeType: ['walmart', 'kroger', 'aldi', 'target', 'meijer', 'hub', 'other'].includes(
        String(parsed.storeType || '').toLowerCase()
      )
        ? String(parsed.storeType).toLowerCase()
        : 'other',
      location: {
        lat: coerceNumber(parsed.location?.lat),
        lng: coerceNumber(parsed.location?.lng)
      }
    };

    return res.json({ ok: true, store: normalized });
  } catch (err) {
    console.error('STORE ENRICH ERROR', err);
    return res.status(500).json({ error: 'Failed to enrich store' });
  }
});

// Create or update a store record
router.post('/', authRequired, ownerRequired, async (req, res) => {
  try {
    const {
      name,
      phone = '',
      address = {},
      storeType = 'other',
      location = {},
      createdFrom,
      isPrimarySupplier
    } = req.body || {};
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'Store name is required.' });
    }

    const payload = {
      name: trimmedName,
      phone: String(phone || ''),
      address: {
        street: String(address.street || '').trim(),
        city: String(address.city || '').trim(),
        state: String(address.state || '').trim(),
        zip: String(address.zip || '').trim(),
        country: String(address.country || '').trim()
      },
      storeType: ['walmart', 'kroger', 'aldi', 'target', 'meijer', 'hub', 'other'].includes(
        String(storeType || '').toLowerCase()
      )
        ? String(storeType).toLowerCase()
        : 'other',
      createdFrom: createdFrom || 'manual',
      isActive: true
    };

    if (typeof isPrimarySupplier === 'boolean') {
      payload.isPrimarySupplier = isPrimarySupplier;
    }

    const lat = coerceNumber(location.lat);
    const lng = coerceNumber(location.lng);
    if (lat !== null && lng !== null) {
      payload.location = { lat, lng };
    }

    const existing = await Store.findOne({ name: trimmedName });
    let store;
    if (existing) {
      await Store.updateOne({ _id: existing._id }, { $set: payload });
      store = await Store.findById(existing._id).lean();
    } else {
      store = await Store.create(payload);
    }

    if (store?.isPrimarySupplier) {
      await Store.updateMany({ _id: { $ne: store._id } }, { $set: { isPrimarySupplier: false } });
    }

    return res.json({ ok: true, store: { ...store, id: store._id?.toString?.() } });
  } catch (err) {
    console.error('STORE UPSERT ERROR', err);
    return res.status(500).json({ error: 'Failed to save store' });
  }
});

// Update store metadata (primary supplier toggle)
router.patch('/:storeId', authRequired, ownerRequired, async (req, res) => {
  try {
    const { storeId } = req.params;
    const { isPrimarySupplier } = req.body || {};

    if (typeof isPrimarySupplier !== 'boolean') {
      return res.status(400).json({ error: 'isPrimarySupplier must be a boolean.' });
    }

    const store = await Store.findById(storeId);
    if (!store) return res.status(404).json({ error: 'Store not found' });

    store.isPrimarySupplier = isPrimarySupplier;
    await store.save();

    if (isPrimarySupplier) {
      await Store.updateMany({ _id: { $ne: store._id } }, { $set: { isPrimarySupplier: false } });
    }

    const updated = await Store.findById(store._id).lean();

    return res.json({ ok: true, store: toStoreResponse(updated) });
  } catch (err) {
    console.error('STORE UPDATE ERROR', err);
    return res.status(500).json({ error: 'Failed to update store' });
  }
});

/**
 * GET /api/stores
 * List all stores
 * Returns stores sorted by name
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const stores = await Store.find({})
      .sort({ name: 1 })
      .lean();

    res.json({
      ok: true,
      stores: stores.map(store => toStoreResponse(store))
    });
  } catch (err) {
    console.error('GET STORES ERROR:', err);
    res.status(500).json({ error: 'Failed to load stores' });
  }
});

// Upsert store-specific pricing/observations from UPC scans or receipts
router.post('/:storeId/prices', authRequired, async (req, res) => {
  try {
    const { storeId } = req.params;
    const {
      items,
      commitId,
      lockPrices,
      lockDurationDays,
      receiptImageUrl,
      receiptThumbnailUrl,
      productId,
      sku,
      upc,
      cost,
      observedPrice,
      priceType = 'regular',
      quantity,
      captureId,
      orderId,
      matchMethod = 'upc'
    } = req.body || {};

    const store = await Store.findById(storeId);
    if (!store) return res.status(404).json({ error: 'Store not found' });

    if (Array.isArray(items)) {
      if (items.length === 0) {
        return res.status(400).json({ error: 'items array is required' });
      }

      if (!receiptImageUrl) {
        return res.status(400).json({ error: 'receiptImageUrl is required for receipt commits' });
      }

      const session = await mongoose.startSession();
      const errors = [];
      let committed = 0;
      const now = new Date();
      const commitKey = String(commitId || `commit_${storeId}_${Date.now()}`);
      const settings = await AppSettings.findOne({ key: 'default' }).lean();
      const settingsLockDays = coerceNumber(settings?.priceLockDays);
      const requestLockDays = coerceNumber(lockDurationDays);
      const lockDays = settingsLockDays || requestLockDays || DEFAULT_PRICE_LOCK_DAYS;
      const lockUntil = lockPrices ? new Date(now.getTime() + lockDays * 24 * 60 * 60 * 1000) : null;

      await session.withTransaction(async () => {
        for (const [index, item] of items.entries()) {
          try {
            const lineIndex = Number.isFinite(item?.lineIndex) ? Number(item.lineIndex) : index;
            const targetProductId = item?.productId;
            if (!targetProductId || !mongoose.Types.ObjectId.isValid(targetProductId)) {
              errors.push({ lineIndex, error: 'Valid productId required' });
              continue;
            }

            const product = await Product.findById(targetProductId).session(session);
            if (!product) {
              errors.push({ lineIndex, error: 'Product not found' });
              continue;
            }

            const qty = Number(item?.quantity) || 1;
            const unitPrice = Number(item?.unitPrice ?? (Number(item?.totalPrice) / qty));

            if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
              errors.push({ lineIndex, error: 'Valid unit price required' });
              continue;
            }

            const existing = await StoreInventory.findOne({
              storeId: store._id,
              productId: product._id
            }).session(session);

            if (existing?.priceLockUntil && existing.priceLockUntil > now) {
              errors.push({ lineIndex, error: `Price locked until ${existing.priceLockUntil.toISOString()}` });
              continue;
            }

            const observedAt = new Date();
            const priceEntry = {
              price: unitPrice,
              observedAt,
              storeId: store._id,
              captureId: commitKey,
              orderId: item?.orderId,
              quantity: qty,
              receiptImageUrl,
              receiptThumbnailUrl,
              matchMethod: item?.matchMethod || 'manual_confirm',
              matchConfidence: Number.isFinite(item?.matchConfidence) ? Number(item.matchConfidence) : 1,
              confirmedBy: req.user?.username || 'unknown',
              priceType: item?.priceType || 'regular',
              promoDetected: Boolean(item?.promoDetected),
              workflowType: item?.workflowType
            };

            const update = {
              $set: {
                observedPrice: unitPrice,
                observedAt,
                updatedAt: observedAt,
                lastVerified: observedAt
              },
              $setOnInsert: {
                storeId: store._id,
                productId: product._id,
                sku: product.sku,
                cost: Number.isFinite(item?.cost) ? Number(item.cost) : unitPrice,
                markup: 1.2,
                available: true,
                stockLevel: 'in-stock'
              },
              $push: {
                priceHistory: {
                  $each: [priceEntry],
                  $slice: -20
                },
                appliedCaptures: {
                  $each: [{ captureId: commitKey, lineIndex, appliedAt: observedAt }],
                  $slice: -50
                }
              }
            };

            if (lockUntil) {
              update.$set.priceLockUntil = lockUntil;
            }

            await StoreInventory.updateOne(
              { storeId: store._id, productId: product._id },
              update,
              { upsert: true, session }
            );

            committed++;
          } catch (itemError) {
            errors.push({ lineIndex: item?.lineIndex ?? index, error: itemError.message });
          }
        }

        await recordAuditLog({
          type: 'receipt_commit',
          actorId: req.user?.username || req.user?.id || 'UNKNOWN',
          details: `Store receipt commit ${commitKey} for ${store.name}. Items committed: ${committed}. Locked: ${lockUntil ? lockUntil.toISOString() : 'no'}. Receipt: ${receiptImageUrl || 'none'} Thumb: ${receiptThumbnailUrl || 'none'}.`
        });
      });

      await session.endSession();

      return res.json({
        ok: true,
        committed,
        lockUntil: lockUntil ? lockUntil.toISOString() : undefined,
        errors: errors.length > 0 ? errors : undefined
      });
    }

    let product = null;
    if (productId) {
      product = await Product.findById(productId);
    } else if (sku) {
      product = await Product.findOne({ sku });
    } else if (upc) {
      const normalizedUpc = String(upc || '').replace(/\D/g, '');
      const upcDoc = await UpcItem.findOne({ upc: normalizedUpc });
      if (upcDoc?.sku) {
        product = await Product.findOne({ sku: upcDoc.sku });
      }
    }

    if (!product) return res.status(404).json({ error: 'Product not found for pricing' });

    const payload = {
      storeId,
      productId: product._id,
      sku: product.sku,
      upc,
      cost,
      observedPrice,
      priceType,
      quantity,
      captureId,
      orderId,
      receiptImageUrl,
      receiptThumbnailUrl,
      matchMethod
    };

    await StoreInventory.create(payload);

    return res.json({ ok: true });
  } catch (err) {
    console.error('STORE PRICE UPDATE ERROR', err);
    return res.status(500).json({ error: 'Failed to save store pricing' });
  }
});

export default router;
