import express from 'express';
import mongoose from 'mongoose';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import { isDbReady } from '../db/connect.js';
import { authRequired, isOwnerUsername } from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import StoreInventory from '../models/StoreInventory.js';

const canManage = (user) => {
  if (!user) return false;
  return user.role === 'OWNER' || user.role === 'MANAGER' || isOwnerUsername(user.username);
};

const router = express.Router();

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
    job.storeCandidate = { ...job.storeCandidate, ...incomingStore };
  }

  // Auto-create store in draft if we have high-confidence candidate without storeId
  let finalStoreId = job.storeCandidate?.storeId;
  if (!finalStoreId && job.storeCandidate?.name) {
    const doc = new Store({
      name: job.storeCandidate.name,
      phone: job.storeCandidate.phone || '',
      address: job.storeCandidate.address || {},
      storeType: job.storeCandidate.storeType || 'other',
      isActive: false,
      createdFrom: 'receipt_upload'
    });
    await doc.save();
    finalStoreId = doc._id;
    job.storeCandidate.storeId = doc._id;
  }

  // Approval logic: create products + emit price observations
  const createdProducts = [];
  const priceObservations = [];
  if (finalStoreId && job.items && job.items.length > 0) {
    for (const item of job.items) {
      try {
        let productId = item.match?.productId;

        // If no existing product, create one
        if (!productId && item.nameCandidate) {
          const newProd = new Product({
            name: item.nameCandidate,
            price: item.unitPrice,
            category: 'uncategorized',
            createdFrom: 'receipt_upload'
          });
          await newProd.save();
          productId = newProd._id;
          createdProducts.push({ id: newProd._id, name: newProd.name });
        }

        // Emit price observation for the store
        if (productId && finalStoreId) {
          const inv = await StoreInventory.findOneAndUpdate(
            { storeId: finalStoreId, productId },
            {
              storeId: finalStoreId,
              productId,
              observedPrice: item.unitPrice,
              costPrice: item.unitPrice, // Default cost = observed
              lastUpdated: new Date(),
              source: 'receipt_upload'
            },
            { new: true, upsert: true }
          );
          priceObservations.push({
            productId,
            storeId: finalStoreId,
            price: item.unitPrice
          });
        }
      } catch (itemErr) {
        console.warn(`Failed to apply item ${item.nameCandidate}:`, itemErr?.message);
      }
    }
  }

  // TODO: Apply approval logic (create/activate store, create products, link UPCs, etc.)
  job.status = 'APPROVED';
  job.metadata = {
    ...job.metadata,
    approvedBy: req.user?.username,
    approvedAt: new Date(),
    storeId: finalStoreId,
    createdProducts,
    priceObservations,
    approvalPayload: req.body || null
  };
  await job.save();

  await recordAuditLog({
    type: 'receipt_approved',
    actorId: req.user?.username || 'unknown',
    details: `jobId=${job._id} storeId=${finalStoreId} products=${createdProducts.length} prices=${priceObservations.length}`
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
