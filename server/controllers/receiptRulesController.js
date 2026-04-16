import mongoose from 'mongoose';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import ReceiptNameAlias from '../models/ReceiptNameAlias.js';
import ReceiptNoiseRule from '../models/ReceiptNoiseRule.js';
import { isDbReady } from '../db/connect.js';
import { recordAuditLog } from '../utils/audit.js';
import { matchStoreCandidate, normalizePhone, normalizeStoreNumber, shouldAutoCreateStore } from '../utils/storeMatcher.js';
import { getReceiptLineNormalizedName } from '../utils/receiptLineResolver.js';
import * as receiptProcessingService from '../services/receiptProcessingService.js';

const { sanitizeSearch } = receiptProcessingService;

export const getReceiptStoreCandidates = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { q } = req.query;
    const safeQuery = sanitizeSearch(q);
    if (!safeQuery) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const stores = await Store.find({ name: { $regex: safeQuery, $options: 'i' } })
      .select('name address phone storeType')
      .limit(20)
      .lean();

    res.json({ ok: true, stores });
  } catch (error) {
    console.error('Error searching store candidates:', error);
    res.status(500).json({ error: 'Failed to search store candidates' });
  }
};

export const postReceiptStoreCandidates = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeName, address, phone, storeType, storeNumber } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeName) {
      return res.status(400).json({ error: 'Store name required' });
    }

    const stored = await Store.findOne({ name: storeName }).lean();
    if (stored) {
      return res.json({ ok: true, existing: stored });
    }

    const allowCreate = shouldAutoCreateStore({
      name: storeName,
      address,
      phone,
      phoneNormalized: normalizePhone(phone),
      storeNumber: normalizeStoreNumber(storeNumber),
      storeType
    });
    if (!allowCreate) {
      return res.status(403).json({ error: 'Auto store creation disabled' });
    }

    const store = await Store.create({
      name: storeName,
      address,
      phone,
      phoneNormalized: normalizePhone(phone),
      storeNumber: normalizeStoreNumber(storeNumber),
      storeType
    });

    await recordAuditLog({
      type: 'receipt_store_create',
      actorId: username,
      details: `storeName=${storeName}`
    });

    res.json({ ok: true, store });
  } catch (error) {
    console.error('Error creating store:', error);
    res.status(500).json({ error: 'Failed to create store' });
  }
};

export const postReceiptNoiseRule = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, normalizedName } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !normalizedName) {
      return res.status(400).json({ error: 'storeId and normalizedName required' });
    }

    const rule = await ReceiptNoiseRule.findOneAndUpdate(
      { storeId, normalizedName },
      { storeId, normalizedName, addedBy: username },
      { new: true, upsert: true }
    );

    await recordAuditLog({
      type: 'receipt_noise_rule_create',
      actorId: username,
      details: `storeId=${storeId} normalizedName=${normalizedName}`
    });

    res.json({ ok: true, rule });
  } catch (error) {
    console.error('Error creating receipt noise rule:', error);
    res.status(500).json({ error: 'Failed to create noise rule' });
  }
};

export const getReceiptNoiseRule = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ error: 'storeId required' });
    }

    const rules = await ReceiptNoiseRule.find({ storeId }).lean();
    res.json({ ok: true, rules });
  } catch (error) {
    console.error('Error fetching noise rules:', error);
    res.status(500).json({ error: 'Failed to fetch noise rules' });
  }
};

export const deleteReceiptNoiseRule = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, normalizedName } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !normalizedName) {
      return res.status(400).json({ error: 'storeId and normalizedName required' });
    }

    await ReceiptNoiseRule.deleteOne({ storeId, normalizedName });

    await recordAuditLog({
      type: 'receipt_noise_rule_delete',
      actorId: username,
      details: `storeId=${storeId} normalizedName=${normalizedName}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting noise rule:', error);
    res.status(500).json({ error: 'Failed to delete noise rule' });
  }
};

export const getReceiptAliases = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ error: 'storeId required' });
    }

    const aliases = await ReceiptNameAlias.find({ storeId })
      .sort({ confirmedCount: -1 })
      .limit(200)
      .lean();

    res.json({ ok: true, aliases });
  } catch (error) {
    console.error('Error fetching receipt aliases:', error);
    res.status(500).json({ error: 'Failed to fetch receipt aliases' });
  }
};

export const getReceiptNoiseRules = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ error: 'storeId required' });
    }

    const rules = await ReceiptNoiseRule.find({ storeId })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({ ok: true, rules });
  } catch (error) {
    console.error('Error fetching receipt noise rules:', error);
    res.status(500).json({ error: 'Failed to fetch receipt noise rules' });
  }
};

export const postReceiptAlias = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, normalizedName, rawName, productId, upc } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !normalizedName || !productId) {
      return res.status(400).json({ error: 'storeId, normalizedName, productId required' });
    }

    const alias = await ReceiptNameAlias.findOneAndUpdate(
      { storeId, normalizedName, productId },
      {
        storeId,
        normalizedName,
        productId,
        upc: upc || undefined,
        $addToSet: {
          rawNames: rawName ? { name: rawName } : undefined
        },
        $inc: { confirmedCount: 1 },
        lastConfirmedAt: new Date(),
        confirmedBy: username
      },
      { new: true, upsert: true }
    );

    await recordAuditLog({
      type: 'receipt_alias_confirm',
      actorId: username,
      details: `storeId=${storeId} name=${normalizedName} product=${productId}`
    });

    res.json({ ok: true, alias });
  } catch (error) {
    console.error('Error creating receipt alias:', error);
    res.status(500).json({ error: 'Failed to create receipt alias' });
  }
};

export const postReceiptNoiseRuleIgnore = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, normalizedName } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !normalizedName) {
      return res.status(400).json({ error: 'storeId and normalizedName required' });
    }

    const rule = await ReceiptNoiseRule.findOneAndUpdate(
      { storeId, normalizedName },
      { storeId, normalizedName, addedBy: username },
      { new: true, upsert: true }
    );

    await recordAuditLog({
      type: 'receipt_noise_rule_ignore',
      actorId: username,
      details: `storeId=${storeId} normalizedName=${normalizedName}`
    });

    res.json({ ok: true, rule });
  } catch (error) {
    console.error('Error creating noise rule:', error);
    res.status(500).json({ error: 'Failed to ignore receipt noise rule' });
  }
};

export const deleteReceiptNoiseRuleIgnore = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, normalizedName } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !normalizedName) {
      return res.status(400).json({ error: 'storeId and normalizedName required' });
    }

    await ReceiptNoiseRule.deleteOne({ storeId, normalizedName });

    await recordAuditLog({
      type: 'receipt_noise_rule_unignore',
      actorId: username,
      details: `storeId=${storeId} normalizedName=${normalizedName}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting noise rule ignore:', error);
    res.status(500).json({ error: 'Failed to unignore receipt noise rule' });
  }
};

export const getReceiptStoreAliases = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ error: 'storeId required' });
    }

    const aliases = await ReceiptNameAlias.find({ storeId })
      .sort({ lastConfirmedAt: -1 })
      .limit(100)
      .lean();

    res.json({ ok: true, aliases });
  } catch (error) {
    console.error('Error fetching store aliases:', error);
    res.status(500).json({ error: 'Failed to fetch store aliases' });
  }
};

export const getReceiptAliasHistory = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, normalizedName } = req.query;
    if (!storeId || !normalizedName) {
      return res.status(400).json({ error: 'storeId and normalizedName required' });
    }

    const alias = await ReceiptNameAlias.findOne({ storeId, normalizedName }).lean();
    if (!alias) {
      return res.json({ ok: true, alias: null });
    }

    res.json({ ok: true, alias });
  } catch (error) {
    console.error('Error fetching alias history:', error);
    res.status(500).json({ error: 'Failed to fetch alias history' });
  }
};

export const postReceiptConfirmMatch = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { receiptName, sku, storeId } = req.body;
    
    // Validate inputs
    if (!receiptName || !sku) {
      return res.status(400).json({ error: 'receiptName and sku are required' });
    }

    // Find the product by SKU
    const product = await Product.findOne({ sku }).lean();
    if (!product) {
      return res.status(404).json({ error: `Product with SKU ${sku} not found` });
    }

    // Validate storeId if provided
    let store = null;
    if (storeId) {
      if (!mongoose.Types.ObjectId.isValid(storeId)) {
        return res.status(400).json({ error: 'Invalid storeId' });
      }
      store = await Store.findById(storeId).lean();
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }
    }

    // Normalize receipt name
    const normalizedName = getReceiptLineNormalizedName(receiptName);

    // Create or update a receipt name alias (binding for future matches)
    const updatedAlias = await ReceiptNameAlias.findOneAndUpdate(
      {
        normalizedName,
        storeId: storeId || { $exists: false }
      },
      {
        $set: {
          productId: product._id,
          upc: product.upc,
          lastConfirmedAt: new Date(),
          lastSeenAt: new Date()
        },
        $inc: { confirmedCount: 1 }
      },
      { new: true, upsert: true }
    );

    // Record audit log
    await recordAuditLog({
      type: 'RECEIPT_ALIAS_CONFIRMED',
      actorId: req.user?.username || req.user?.id,
      details: `Confirmed receipt "${receiptName}" → SKU ${sku}${storeId ? ` @ Store ${storeId}` : ''}`
    });

    res.json({ 
      ok: true, 
      message: 'Receipt item match confirmed',
      receiptName: normalizedName,
      sku,
      productId: product._id,
      storeId: storeId || null,
      aliasId: updatedAlias._id
    });
  } catch (error) {
    console.error('Receipt confirm match error:', error);
    res.status(500).json({ error: 'Failed to confirm match' });
  }
};