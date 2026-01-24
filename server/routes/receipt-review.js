import express from 'express';
import mongoose from 'mongoose';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import { isDbReady } from '../db/connect.js';
import { authRequired, isOwnerUsername } from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import StoreInventory from '../models/StoreInventory.js';
import UpcItem from '../models/UpcItem.js';
import { generateSku } from '../utils/sku.js';

const canManage = (user) => {
  if (!user) return false;
  return user.role === 'OWNER' || user.role === 'MANAGER' || isOwnerUsername(user.username);
};

const router = express.Router();

const normalizeBarcode = value => String(value || '').replace(/\D/g, '');

const normalizePrice = (unitPrice, lineTotal, quantity) => {
  const parsedUnit = Number(unitPrice);
  if (Number.isFinite(parsedUnit)) return parsedUnit;
  const parsedLineTotal = Number(lineTotal);
  const parsedQty = Number(quantity);
  if (Number.isFinite(parsedLineTotal) && Number.isFinite(parsedQty) && parsedQty > 0) {
    return parsedLineTotal / parsedQty;
  }
  return null;
};

const escapeRegex = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toPlain = value => (value?.toObject ? value.toObject() : value);

// GET /api/receipts?status=NEEDS_REVIEW
router.get('/receipts', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  if (!canManage(req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { status } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const query = status ? { status } : {};
  const jobs = await ReceiptParseJob.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ ok: true, jobs });
});

// GET /api/receipts/:id
router.get('/receipts/:id', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  if (!canManage(req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const job = await ReceiptParseJob.findById(req.params.id).lean();
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, job });
});

// POST /api/receipts/:id/approve
router.post('/receipts/:id/approve', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  if (!canManage(req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const job = await ReceiptParseJob.findById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });

  const incomingStore = req.body?.storeCandidate;
  if (incomingStore) {
    job.storeCandidate = { ...toPlain(job.storeCandidate), ...incomingStore };
  }
  const incomingItems = Array.isArray(req.body?.items) ? req.body.items : null;
  if (incomingItems) {
    job.items = incomingItems;
  }

  const storeCandidate = job.storeCandidate || {};
  let store = null;
  const storeIdCandidate = storeCandidate.storeId;
  if (storeIdCandidate && mongoose.Types.ObjectId.isValid(storeIdCandidate)) {
    store = await Store.findById(storeIdCandidate);
  }
  if (!store && storeCandidate.name) {
    store = await Store.findOne({
      name: new RegExp(`^${escapeRegex(storeCandidate.name)}$`, 'i')
    });
  }

  let storeCreated = false;
  if (!store) {
    if (!storeCandidate.name) {
      return res.status(400).json({ error: 'Store candidate is required for approval.' });
    }
    try {
      store = await Store.create({
        name: storeCandidate.name,
        phone: storeCandidate.phone || '',
        address: storeCandidate.address || {},
        storeType: storeCandidate.storeType || 'other',
        isActive: false,
        createdFrom: 'receipt_upload'
      });
      storeCreated = true;
    } catch (err) {
      if (err?.code === 11000) {
        store = await Store.findOne({
          name: new RegExp(`^${escapeRegex(storeCandidate.name)}$`, 'i')
        });
      }
      if (!store) {
        throw err;
      }
    }
  }

  if (store && job.storeCandidate) {
    job.storeCandidate.storeId = store._id;
  }

  if (storeCreated && store) {
    await recordAuditLog({
      type: 'store_created_from_receipt',
      actorId: req.user?.username || 'unknown',
      details: `jobId=${job._id} storeId=${store._id} name=${store.name}`
    });
  }

  const createdProducts = [];
  const linkedUpcs = [];
  const inventoryUpdates = [];
  const warnings = [];

  const items = Array.isArray(job.items) ? job.items : [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.actionSuggestion === 'IGNORE') {
      continue;
    }

    let productDoc = null;
    const productId = item.match?.productId;
    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      productDoc = await Product.findById(productId);
    }

    if (!productDoc && item.actionSuggestion === 'CREATE_PRODUCT') {
      const unitPrice = normalizePrice(item.unitPrice, item.lineTotal, item.quantity);
      if (unitPrice === null) {
        warnings.push({ index, reason: 'invalid_unit_price' });
      } else {
        const sku = await generateSku();
        const name = item.nameCandidate || item.rawLine || 'Unnamed Product';
        productDoc = await Product.create({
          frontendId: sku,
          sku,
          name,
          price: unitPrice,
          deposit: 0,
          stock: 0,
          sizeOz: 0,
          isTaxable: true,
          category: 'DRINK',
          brand: item.brandCandidate || '',
          productType: '',
          storageZone: '',
          storageBin: '',
          isGlass: false,
          isHeavy: false,
          store: store?._id
        });
        createdProducts.push({
          id: productDoc._id,
          sku: productDoc.sku,
          name: productDoc.name,
          index
        });
        await recordAuditLog({
          type: 'product_created_from_receipt',
          actorId: req.user?.username || 'unknown',
          details: `jobId=${job._id} productId=${productDoc._id} sku=${productDoc.sku} name=${productDoc.name}`
        });
      }
    }

    const shouldLinkUpc =
      item.actionSuggestion === 'LINK_UPC_TO_PRODUCT' ||
      item.actionSuggestion === 'CREATE_UPC';
    const normalizedUpc = normalizeBarcode(item.upcCandidate);
    if (shouldLinkUpc && normalizedUpc) {
      if (!productDoc) {
        warnings.push({ index, reason: 'upc_link_missing_product' });
      } else if (!productDoc.sku) {
        warnings.push({ index, reason: 'upc_link_missing_sku' });
      } else {
        await UpcItem.findOneAndUpdate(
          { upc: normalizedUpc },
          { $set: { sku: productDoc.sku, name: productDoc.name } },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        linkedUpcs.push({
          upc: normalizedUpc,
          sku: productDoc.sku,
          productId: productDoc._id,
          index
        });
        await recordAuditLog({
          type: 'upc_linked_from_receipt',
          actorId: req.user?.username || 'unknown',
          details: `jobId=${job._id} upc=${normalizedUpc} sku=${productDoc.sku} productId=${productDoc._id}`
        });
      }
    }

    if (store && productDoc) {
      const unitPrice = normalizePrice(item.unitPrice, item.lineTotal, item.quantity);
      if (unitPrice === null) {
        warnings.push({ index, reason: 'inventory_update_missing_price' });
        continue;
      }

      const updated = await StoreInventory.findOneAndUpdate(
        { storeId: store._id, productId: productDoc._id },
        {
          $set: {
            sku: productDoc.sku,
            observedPrice: unitPrice,
            observedAt: new Date(),
            lastVerified: new Date(),
            available: true,
            stockLevel: 'in-stock'
          },
          $setOnInsert: {
            cost: unitPrice,
            markup: 1.2
          }
        },
        { new: true, upsert: true }
      );

      inventoryUpdates.push({
        storeId: store._id,
        productId: productDoc._id,
        price: unitPrice,
        inventoryId: updated?._id,
        index
      });
    }
  }

  job.status = 'APPROVED';
  job.metadata = {
    ...job.metadata,
    approvedBy: req.user?.username,
    approvedAt: new Date(),
    storeId: store?._id,
    storeCreated,
    createdProducts,
    linkedUpcs,
    inventoryUpdates,
    warnings,
    approvalPayload: req.body || null
  };
  await job.save();

  await recordAuditLog({
    type: 'receipt_approved',
    actorId: req.user?.username || 'unknown',
    details: `jobId=${job._id} storeId=${store?._id || 'none'} products=${createdProducts.length} upcs=${linkedUpcs.length} inventory=${inventoryUpdates.length}`
  });

  res.json({ ok: true, job });
});

// POST /api/receipts/:id/reject
router.post('/receipts/:id/reject', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  if (!canManage(req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const job = await ReceiptParseJob.findById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  job.status = 'REJECTED';
  job.metadata = {
    ...job.metadata,
    rejectedBy: req.user?.username,
    rejectedAt: new Date(),
    rejectionReason: req.body?.reason || 'unspecified'
  };
  await job.save();

  await recordAuditLog({
    type: 'receipt_rejected',
    actorId: req.user?.username || 'unknown',
    details: `jobId=${job._id} reason=${req.body?.reason || 'unspecified'}`
  });

  res.json({ ok: true });
});

export default router;
