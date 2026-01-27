import express from 'express';
import mongoose from 'mongoose';
import ReceiptCapture from '../models/ReceiptCapture.js';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import StoreInventory from '../models/StoreInventory.js';
import UpcItem from '../models/UpcItem.js';
import { isDbReady } from '../db/connect.js';
import { authRequired, isOwnerUsername } from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';
import { matchStoreCandidate } from '../utils/storeMatcher.js';
import { generateSku } from '../utils/sku.js';

const router = express.Router();

const canApproveReceipts = user => {
  if (!user) return false;
  return user.role === 'OWNER' || user.role === 'MANAGER' || isOwnerUsername(user.username);
};

const normalizeBarcode = value => String(value || '').replace(/\D/g, '');

const resolveUnitPrice = item => {
  const parsedUnit = Number(item?.unitPrice);
  if (Number.isFinite(parsedUnit) && parsedUnit > 0) return parsedUnit;
  const total = Number(item?.totalPrice);
  const qty = Number(item?.quantity) || 1;
  if (Number.isFinite(total) && total > 0 && Number.isFinite(qty) && qty > 0) {
    return total / qty;
  }
  return null;
};

const buildStoreCandidate = (capture, parseJob, body) => {
  if (body?.storeCandidate) return body.storeCandidate;
  if (parseJob?.storeCandidate) return parseJob.storeCandidate;
  const name = body?.storeName || capture?.storeName;
  const storeId = body?.storeId || capture?.storeId;
  if (!name && !storeId) return null;
  return {
    name,
    storeId,
    address: body?.storeAddress,
    phone: body?.storePhone,
    storeType: body?.storeType
  };
};

// GET /api/receipts?status=NEEDS_REVIEW
// Role-neutral endpoint for fetching receipt parse jobs
router.get('/', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  if (!canApproveReceipts(req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  // Support status as comma-separated or repeated query params
  let statusList = [];
  if (req.query.status) {
    if (Array.isArray(req.query.status)) {
      // Repeated ?status=...&status=...
      statusList = req.query.status.flatMap(s => String(s).split(',').map(x => x.trim()).filter(Boolean));
    } else if (typeof req.query.status === 'string') {
      statusList = String(req.query.status).split(',').map(x => x.trim()).filter(Boolean);
    }
  }
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  let baseQuery = {};
  if (statusList.length === 1) {
    baseQuery.status = statusList[0];
  } else if (statusList.length > 1) {
    baseQuery.status = { $in: statusList };
  }

  // Role-based filtering: drivers see only their captures
  const isDriver = req.user?.role === 'DRIVER';
  const query = isDriver && req.user?.id
    ? { ...baseQuery, createdByUserId: req.user.id }
    : baseQuery;

  const jobs = await ReceiptParseJob.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ ok: true, jobs });
});

// GET /api/receipts/:jobId
// Role-neutral endpoint for fetching a single receipt parse job
router.get('/:jobId', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  if (!canApproveReceipts(req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const job = await ReceiptParseJob.findById(req.params.jobId).lean();
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, job });
});

// POST /api/receipts/:jobId/approve
router.post('/:jobId/approve', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  if (!canApproveReceipts(req.user)) {
    return res.status(403).json({ error: 'Not authorized to approve receipts' });
  }

  const session = await mongoose.startSession();

  try {
    const { jobId } = req.params;
    const { mode, selectedIndices, lockDurationDays, idempotencyKey, forceUpcOverride, finalStoreId } = req.body || {};
    const username = req.user?.username || 'unknown';

    if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'Valid jobId required' });
    }

    if (!idempotencyKey || String(idempotencyKey).trim().length < 8) {
      return res.status(400).json({ error: 'idempotencyKey is required' });
    }

    const parseJob = await ReceiptParseJob.findById(jobId).session(session);
    if (!parseJob) {
      return res.status(404).json({ error: 'Receipt parse job not found' });
    }

    if (parseJob.status === 'REJECTED') {
      return res.status(409).json({ error: 'Cannot approve a rejected job' });
    }
    if (parseJob.status === 'APPROVED') {
      // Idempotent success
      return res.json({ ok: true, idempotent: true, jobId });
    }

    if (!parseJob.captureId) {
      return res.status(400).json({ error: 'Parse job missing captureId' });
    }

    const capture = await ReceiptCapture.findById(parseJob.captureId).session(session);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found for job' });
    }

    if (!['PARSED', 'NEEDS_REVIEW'].includes(parseJob.status)) {
      return res.status(409).json({ error: 'Job not in approvable status' });
    }

    if (capture.status === 'committed') {
      return res.json({ ok: true, captureId, status: capture.status, idempotent: true });
    }

    const normalizedMode = mode || 'safe';
    if (!['safe', 'selected', 'locked', 'all'].includes(normalizedMode)) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    if (normalizedMode === 'selected' && (!Array.isArray(selectedIndices) || selectedIndices.length === 0)) {
      return res.status(400).json({ error: 'selectedIndices required for selected mode' });
    }

    // Safe mode: only apply high-confidence items (no warnings, has match.productId)
    const SAFE_CONFIDENCE = 0.8;

    const selectedSet = Array.isArray(selectedIndices)
      ? new Set(selectedIndices.map(Number))
      : null;

    session.startTransaction();
    const storeCandidate = buildStoreCandidate(capture, parseJob, req.body);

    let store = null;
    const effectiveStoreId = finalStoreId || storeCandidate?.storeId;
    if (effectiveStoreId && mongoose.Types.ObjectId.isValid(effectiveStoreId)) {
      store = await Store.findById(effectiveStoreId).session(session);
    } else if (storeCandidate) {
      store = await Store.findById(storeCandidate.storeId).session(session);
    }

    if (!store && storeCandidate) {
      const matchResult = await matchStoreCandidate(storeCandidate);
      // Require explicit selection if ambiguous/low confidence
      if (matchResult?.ambiguous || (matchResult?.confidence !== undefined && matchResult.confidence < 0.7)) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Ambiguous storeCandidate; provide finalStoreId' });
      }
      if (matchResult?.match?._id) {
        store = await Store.findById(matchResult.match._id).session(session);
      }
    }

    let storeCreated = false;
    if (!store) {
      const candidateName = storeCandidate?.name || capture.storeName;
      if (!candidateName) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Store name is required to approve receipt' });
      }

      try {
        store = await Store.create([
          {
            name: candidateName,
            phone: storeCandidate?.phone || '',
            address: storeCandidate?.address || {},
            storeType: storeCandidate?.storeType || 'other',
            isActive: false,
            createdFrom: 'receipt_upload'
          }
        ], { session });
        store = store[0];
        storeCreated = true;
      } catch (err) {
        if (err?.code === 11000) {
          store = await Store.findOne({ name: candidateName }).session(session);
        }
        if (!store) {
          throw err;
        }
      }
    }

    if (!store) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Unable to resolve store for receipt' });
    }

    capture.storeId = store._id;
    capture.storeName = store.name;
    if (parseJob?.storeCandidate) {
      parseJob.storeCandidate.storeId = store._id;
    }

    if (storeCreated) {
      await recordAuditLog({
        type: 'store_created_from_receipt',
        actorId: username,
        details: `captureId=${capture._id.toString()} storeId=${store._id.toString()} name=${store.name}`
      });
    }

    const createdProducts = [];
    const matchedProducts = [];
    const inventoryUpdates = [];
    const errors = [];

    const itemsToApprove = capture.draftItems.filter(item => {
      if (normalizedMode === 'selected') {
        return selectedSet?.has(item.lineIndex);
      }
      if (normalizedMode === 'safe') {
        const jobItem = (parseJob.items || []).find(i => Number(i.lineIndex) === Number(item.lineIndex));
        const confidence = Number(jobItem?.match?.confidence || item.matchConfidence || 0);
        const hasWarnings = Array.isArray(jobItem?.warnings) && jobItem.warnings.length > 0;
        const hasProduct = Boolean(jobItem?.match?.productId || item.boundProductId || item.suggestedProduct?.id);
        return !hasWarnings && hasProduct && confidence >= SAFE_CONFIDENCE;
      }
      return true; // 'all' and 'locked' default to everything
    });

    for (const item of itemsToApprove) {
      try {
        const unitPrice = resolveUnitPrice(item);
        if (!unitPrice) {
          errors.push({ lineIndex: item.lineIndex, error: 'Invalid unit price' });
          continue;
        }

        const normalizedUpc = normalizeBarcode(item.boundUpc || item.suggestedProduct?.upc);

        let product = null;
        if (item.boundProductId && mongoose.Types.ObjectId.isValid(item.boundProductId)) {
          product = await Product.findById(item.boundProductId).session(session);
        }

        if (!product && item.suggestedProduct?.id && mongoose.Types.ObjectId.isValid(item.suggestedProduct.id)) {
          product = await Product.findById(item.suggestedProduct.id).session(session);
        }

        if (!product && normalizedUpc) {
          const upcEntry = await UpcItem.findOne({ upc: normalizedUpc }).session(session);
          if (upcEntry?.productId) {
            product = await Product.findById(upcEntry.productId).session(session);
          }
        }

        let productCreated = false;
        if (!product) {
          const sku = await generateSku();
          const name = item.receiptName || item.normalizedName || 'Receipt Item';
          const created = await Product.create([
            {
              frontendId: sku,
              sku,
              name,
              price: unitPrice,
              deposit: 0,
              stock: 0,
              sizeOz: 0,
              isTaxable: true,
              category: 'DRINK',
              brand: item.tokens?.brand || '',
              productType: '',
              storageZone: '',
              storageBin: '',
              isGlass: false,
              isHeavy: false,
              store: store._id
            }
          ], { session });
          product = created[0];
          productCreated = true;
          createdProducts.push({
            id: product._id,
            sku: product.sku,
            name: product.name,
            lineIndex: item.lineIndex
          });

          await recordAuditLog({
            type: 'product_created_from_receipt',
            actorId: username,
            details: `captureId=${capture._id.toString()} productId=${product._id.toString()} sku=${product.sku} name=${product.name}`
          });
        }

        if (product && !productCreated) {
          matchedProducts.push({
            id: product._id,
            sku: product.sku,
            name: product.name,
            lineIndex: item.lineIndex
          });
        }

        item.boundProductId = product._id;
        if (normalizedUpc) {
          item.boundUpc = normalizedUpc;
        }
        item.confirmedAt = item.confirmedAt || new Date();
        item.confirmedBy = item.confirmedBy || username;
        item.needsReview = false;

        // Concurrency guard: insert apply ledger; skip if duplicate
        const { default: ReceiptApplyLedger } = await import('../models/ReceiptApplyLedger.js');
        try {
          await ReceiptApplyLedger.create([
            {
              captureId: capture._id.toString(),
              lineIndex: Number(item.lineIndex),
              productId: product._id,
              storeId: store._id,
              idempotencyKey: String(idempotencyKey)
            }
          ], { session });
        } catch (dupeErr) {
          if (dupeErr?.code === 11000) {
            // Already applied for this line; skip
            matchedProducts.push({ id: product._id, sku: product.sku, name: product.name, lineIndex: item.lineIndex });
            continue;
          }
          throw dupeErr;
        }

        // Check if price is locked
        const existingInventory = await StoreInventory.findOne({
          storeId: store._id,
          productId: product._id
        }).session(session);

        const isLocked = existingInventory?.priceLockUntil && new Date(existingInventory.priceLockUntil) > new Date();
        if (isLocked) {
          errors.push({
            lineIndex: item.lineIndex,
            error: 'Price locked',
            lockedUntil: existingInventory.priceLockUntil
          });
          continue;
        }

        const inventory = await StoreInventory.findOneAndUpdate(
          { storeId: store._id, productId: product._id },
          {
            $set: {
              sku: product.sku,
              observedPrice: unitPrice,
              observedAt: new Date(),
              lastVerified: new Date(),
              available: true,
              stockLevel: 'in-stock'
            },
            $setOnInsert: {
              cost: unitPrice,
              markup: 1.2
            },
            $push: {
              priceHistory: {
                price: unitPrice,
                observedAt: new Date(),
                storeId: store._id,
                captureId: capture._id.toString(),
                orderId: capture.orderId,
                quantity: Number(item.quantity || 1),
                receiptImageUrl: capture.images?.[0]?.url,
                receiptThumbnailUrl: capture.images?.[0]?.thumbnailUrl,
                matchMethod: item.matchMethod || 'manual_confirm',
                matchConfidence: item.matchConfidence,
                confirmedBy: username,
                priceType: item.priceType || 'unknown',
                promoDetected: item.promoDetected || false,
                workflowType: productCreated ? 'new_product' : 'update_price'
              }
            },
            $addToSet: {
              appliedCaptures: {
                captureId: capture._id.toString(),
                lineIndex: item.lineIndex,
                appliedAt: new Date()
              }
            }
          },
          { new: true, upsert: true, session }
        );

        if (normalizedMode === 'locked') {
          const lockDays = Number(lockDurationDays) || 7;
          const lockUntil = new Date(Date.now() + lockDays * 24 * 60 * 60 * 1000);
          await StoreInventory.findByIdAndUpdate(
            inventory._id,
            { $set: { priceLockUntil: lockUntil } },
            { session }
          );
        }

        inventoryUpdates.push({
          storeId: store._id,
          productId: product._id,
          price: unitPrice,
          inventoryId: inventory._id,
          lineIndex: item.lineIndex
        });

        // UPC linking to productId, with conflict handling
        if (normalizedUpc) {
          const existingUpc = await UpcItem.findOne({ upc: normalizedUpc }).session(session);
          if (existingUpc && existingUpc.productId && String(existingUpc.productId) !== String(product._id)) {
            if (!forceUpcOverride) {
              errors.push({ lineIndex: item.lineIndex, error: 'UPC already linked to different product', upc: normalizedUpc });
            } else {
              await UpcItem.updateOne(
                { upc: normalizedUpc },
                { $set: { productId: product._id, name: product.name } },
                { session }
              );
              await recordAuditLog({
                type: 'upc_linked_from_receipt',
                actorId: username,
                details: `captureId=${capture._id.toString()} upc=${normalizedUpc} productId=${product._id.toString()} override=true`
              });
            }
          } else {
            await UpcItem.findOneAndUpdate(
              { upc: normalizedUpc },
              { $set: { productId: product._id, name: product.name } },
              { new: true, upsert: true, setDefaultsOnInsert: true, session }
            );
            await recordAuditLog({
              type: 'upc_linked_from_receipt',
              actorId: username,
              details: `captureId=${capture._id.toString()} upc=${normalizedUpc} productId=${product._id.toString()}`
            });
          }
        }
      } catch (itemError) {
        errors.push({ lineIndex: item.lineIndex, error: itemError.message });
      }
    }

    const previousCommitted = Number(capture.itemsCommitted || 0);
    capture.itemsCommitted = Math.min(capture.totalItems, previousCommitted + itemsToApprove.length);
    capture.itemsConfirmed = capture.draftItems.filter(entry => entry.boundProductId).length;
    capture.itemsNeedingReview = capture.draftItems.filter(entry => entry.needsReview).length;
    capture.committedBy = username;
    capture.committedAt = new Date();
    if (normalizedMode === 'safe') {
      capture.status = 'committed';
      capture.reviewExpiresAt = undefined;
    }

    await capture.save({ session });

    if (parseJob) {
      parseJob.status = 'APPROVED';
      parseJob.metadata = {
        ...parseJob.metadata,
        approvedBy: username,
        approvedAt: new Date(),
        storeId: store._id,
        createdProducts,
        matchedProducts,
        inventoryUpdates,
        approvalPayload: req.body || null
      };
      await parseJob.save({ session });
    }

    await session.commitTransaction();

    await recordAuditLog({
      type: 'receipt_approved',
      actorId: username,
      details: `jobId=${jobId} captureId=${capture._id.toString()} storeId=${store._id.toString()} productsCreated=${createdProducts.length} inventoryUpdates=${inventoryUpdates.length} mode=${normalizedMode}`
    });

    res.json({
      ok: true,
      jobId,
      captureId: capture._id.toString(),
      storeId: store._id,
      createdProducts,
      matchedProducts,
      inventoryUpdates,
      errors: errors.length ? errors : undefined
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error approving receipt:', error);
    res.status(500).json({ error: 'Failed to approve receipt' });
  } finally {
    await session.endSession();
  }
});

// POST /api/receipts/:jobId/reject
// Role-neutral endpoint for rejecting a receipt parse job
router.post('/:jobId/reject', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  if (!canApproveReceipts(req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const job = await ReceiptParseJob.findById(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Not found' });
  if (job.status === 'APPROVED') {
    return res.status(409).json({ error: 'Cannot reject an approved job' });
  }
  const alreadyRejected = job.status === 'REJECTED';
  job.status = 'REJECTED';
  job.metadata = {
    ...job.metadata,
    rejectedBy: req.user?.username,
    rejectedAt: new Date(),
    rejectionReason: req.body?.reason || 'unspecified'
  };
  await job.save();

  if (!alreadyRejected) {
    await recordAuditLog({
      type: 'receipt_rejected',
      actorId: req.user?.username || 'unknown',
      details: `jobId=${job._id} reason=${req.body?.reason || 'unspecified'}`
    });
  }

  res.json({ ok: true });
});

export default router;
