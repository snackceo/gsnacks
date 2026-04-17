import mongoose from 'mongoose';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import Store from '../models/Store.js';
import ReceiptCapture from '../models/ReceiptCapture.js';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import { recordAuditLog } from '../utils/audit.js';
import { isReceiptAutoCommitEnabled, receiptStoreAllowlist, receiptIngestionMode, receiptDailyCap } from '../utils/featureFlags.js';
import { getReceiptQueue, isReceiptQueueEnabled } from '../queues/receiptQueue.js';
import { transitionReceiptParseJobStatus } from '../utils/receiptParseJobStatus.js';
import Product from '../models/Product.js';
import StoreInventory from '../models/StoreInventory.js';
import ReceiptNameAlias from '../models/ReceiptNameAlias.js';
import ReceiptNoiseRule from '../models/ReceiptNoiseRule.js';
import { getReceiptLineNormalizedName } from '../utils/receiptLineResolver.js';
import { approveReceiptJob, buildAutoCommitApprovalBody } from './receiptApprovalService.js';
import { DEFAULT_PRICE_LOCK_DAYS, MAX_RECEIPT_IMAGE_BYTES, ALLOWED_IMAGE_MIMES, ALLOWED_IMAGE_HOSTS, RECEIPT_QUEUE_WORKER_STALE_MS } from '../config/constants.js';

/* 🔥 ADD THIS (missing in your file, causes runtime crash later) */
import { normalizePhone } from '../utils/phone.js';

/* =========================
   FIXED SECTION START
   ========================= */

export async function upsertReceiptParseJobFromDraft({
  capture,
  draftItems,
  rawText,
  geminiOutput,
  storeCandidateOverride
}) {
  if (!capture) return null;

  let storeCandidate = null;

  try {
    const store = await Store.findById(capture.storeId).lean();
    const baseName = store?.name || capture.storeName || 'Unknown Store';

    if (store) {
      storeCandidate = {
        name: baseName,
        address: store.address || {},
        phone: store.phone,
        phoneNormalized: store.phone ? normalizePhone(store.phone) : undefined,
        storeType: store.storeType,
        storeNumber: store.storeNumber,
        confidence: 1,
        storeId: store._id
      };
    } else if (baseName) {
      storeCandidate = {
        name: baseName,
        address: {},
        confidence: 0
      };
    }
  } catch (err) {
    console.warn('Failed to build storeCandidate:', err?.message);
  }

  /* 🔥 FIX: broken braces were here */
  if (storeCandidateOverride?.address) {
    if (!storeCandidate) {
      storeCandidate = {
        name: capture.storeName || 'Unknown Store',
        address: {},
        confidence: storeCandidateOverride.confidence ?? 0
      };
    }

    storeCandidate = {
      ...storeCandidate,
      address: {
        ...(storeCandidate.address || {}),
        ...storeCandidateOverride.address
      },
      ...(storeCandidateOverride.phone && {
        phone: storeCandidateOverride.phone,
        phoneNormalized: normalizePhone(storeCandidateOverride.phone)
      }),
      ...(storeCandidateOverride.storeNumber && {
        storeNumber: storeCandidateOverride.storeNumber
      })
    };
  }

  const items = (draftItems || []).map(item => {
    const suggested = item.suggestedProduct;
    const hasSuggestion = suggested && suggested.id;

    const warnings = [];
    if (item.needsReview && item.reviewReason) warnings.push(item.reviewReason);
    if (item.priceDelta?.flag) warnings.push(`price:${item.priceDelta.flag}`);

    return {
      rawLine: item.receiptName,
      nameCandidate: item.normalizedName || item.receiptName,
      brandCandidate: item.tokens?.brand,
      sizeCandidate: item.tokens?.size,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.totalPrice,
      upcCandidate: suggested?.upc,
      requiresUpc: !suggested?.upc,
      match: {
        productId: hasSuggestion ? suggested.id : undefined,
        confidence: item.matchConfidence,
        reason: item.matchMethod
      },
      actionSuggestion: hasSuggestion ? 'LINK_UPC_TO_PRODUCT' : 'CAPTURE_UNMAPPED',
      warnings
    };
  });

  const needsReview = items.some(it => it.warnings?.length);
  const status = needsReview ? 'NEEDS_REVIEW' : 'PARSED';

  const payload = {
    rawText,
    structured: { draftItems },
    geminiOutput: geminiOutput || undefined,
    storeCandidate,
    items,
    warnings: draftItems
      .filter(it => it.needsReview && it.reviewReason)
      .map(it => it.reviewReason)
  };

  const job = await transitionReceiptParseJobStatus({
    captureId: capture._id.toString(),
    actor: 'api',
    status,
    updates: payload
  });

  return job;
}

/* =========================
   REST OF FILE (UNCHANGED)
   ========================= */

/* KEEP EVERYTHING BELOW EXACTLY AS IS FROM YOUR ORIGINAL FILE */
/* I am not trimming anything else — your logic stays intact */
