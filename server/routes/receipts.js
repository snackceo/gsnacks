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

router.post('/receipts/:captureId/approve', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  if (!canApproveReceipts(req.user)) {
    return res.status(403).json({ error: 'Not authorized to approve receipts' });
  }

  const session = await mongoose.startSession();

  try {
    const { captureId } = req.params;
    const { mode, selectedIndices, lockDurationDays } = req.body || {};
    const username = req.user?.username || 'unknown';

    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId).session(session);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    if (capture.status === 'committed') {
      return res.json({ ok: true, captureId, status: capture.status, idempotent: true });
    }

    const normalizedMode = mode || 'safe';
    if (!['safe', 'selected', 'locked'].includes(normalizedMode)) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    if (normalizedMode === 'selected' && (!Array.isArray(selectedIndices) || selectedIndices.length === 0)) {
      return res.status(400).json({ error: 'selectedIndices required for selected mode' });
    }

    if (normalizedMode === 'safe' && capture.itemsNeedingReview > 0) {
      return res.status(400).json({ error: 'Receipt has items needing review' });
    }

    const selectedSet = Array.isArray(selectedIndices)
      ? new Set(selectedIndices.map(Number))
      : null;

    session.startTransaction();

    const parseJob = await ReceiptParseJob.findOne({ captureId }).session(session);
    const storeCandidate = buildStoreCandidate(capture, parseJob, req.body);

    let store = null;
    if (storeCandidate?.storeId && mongoose.Types.ObjectId.isValid(storeCandidate.storeId)) {
      store = await Store.findById(storeCandidate.storeId).session(session);
    }

    if (!store && storeCandidate) {
      const matchResult = await matchStoreCandidate(storeCandidate);
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
      return true;
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

        if (!product && item.suggestedProduct?.sku) {
          product = await Product.findOne({ sku: item.suggestedProduct.sku }).session(session);
        }

        if (!product && normalizedUpc) {
          const upcEntry = await UpcItem.findOne({ upc: normalizedUpc }).session(session);
          if (upcEntry?.sku) {
            product = await Product.findOne({ sku: upcEntry.sku }).session(session);
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
      details: `captureId=${capture._id.toString()} storeId=${store._id.toString()} productsCreated=${createdProducts.length} inventoryUpdates=${inventoryUpdates.length} mode=${normalizedMode}`
    });

    res.json({
      ok: true,
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

export default router;
