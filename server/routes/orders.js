import express from 'express';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import UpcItem from '../models/UpcItem.js';
import User from '../models/User.js';
import LedgerEntry from '../models/LedgerEntry.js';
import CashPayout from '../models/CashPayout.js';
import {
  authRequired,
  buildReturnCountUpdates,
  isDriverUsername,
  isOwnerUsername,
  mapOrderForFrontend,
  normalizeReturnPayoutMethod,
  normalizeUpcCounts,
  calculateReturnFeeSummary,
  sumReturnCredits,
  ownerRequired,
  releaseCreditAuthorization,
  restockOrderItems, // eslint-disable-line no-unused-vars
  voidStripeAuthorizationBestEffort
} from '../utils/helpers.js';
import { isDbReady } from '../db/connect.js';
import { recordAuditLog } from '../utils/audit.js';
import refundsRouter from './refunds.js';

const CASH_HANDLING_FEE_PER_CONTAINER = 0.02;
const GLASS_HANDLING_SURCHARGE_PER_CONTAINER = 0.02;

const getReturnFeeConfig = async () => ({
  returnHandlingFeePerContainer: CASH_HANDLING_FEE_PER_CONTAINER,
  glassHandlingFeePerContainer: GLASS_HANDLING_SURCHARGE_PER_CONTAINER
});

const createOrdersRouter = ({ stripe }) => {
  const router = express.Router();

  router.use('/refunds', refundsRouter);

  /* =========================
     ORDERS
     - Owner sees all
     - Customers see their own
  ========================= */
  router.get('/', authRequired, async (req, res) => {
    if (!isDbReady()) {
      return res.status(503).json({ error: 'Database not ready' });
    }
    try {
      const isOwner = isOwnerUsername(req.user?.username);
      const isDriver = isDriverUsername(req.user?.username);
      const q = isOwner
        ? {}
        : isDriver
          ? { driverId: req.user?.username || req.user?.id }
          : { customerId: req.user?.id };

      const limitRaw = Number.parseInt(String(req.query?.limit ?? ''), 10);
      const skipRaw = Number.parseInt(String(req.query?.skip ?? ''), 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200;
      const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? skipRaw : 0;

      const startDateRaw = String(req.query?.startDate ?? '');
      const endDateRaw = String(req.query?.endDate ?? '');
      const startDate = startDateRaw ? new Date(startDateRaw) : null;
      const endDate = endDateRaw ? new Date(endDateRaw) : null;

      if (
        (startDate && !Number.isNaN(startDate.getTime())) ||
        (endDate && !Number.isNaN(endDate.getTime()))
      ) {
        q.createdAt = {};
        if (startDate && !Number.isNaN(startDate.getTime())) {
          q.createdAt.$gte = startDate;
        }
        if (endDate && !Number.isNaN(endDate.getTime())) {
          q.createdAt.$lte = endDate;
        }
      }

      // Pure read: no writes, always lean
      const [docs, total] = await Promise.all([
        Order.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Order.countDocuments(q)
      ]);

      const orders = docs.map(mapOrderForFrontend);

      res.json({ ok: true, orders, pagination: { limit, skip, total } });
    } catch (err) {
      console.error('GET ORDERS ERROR:', err);
      res.status(500).json({ error: 'Failed to load orders' });
    }
  });

  /**
   * POST /api/orders/backfill-return-counts (owner-only)
   * Backfill returnUpcCounts/verifiedReturnUpcCounts for legacy records.
   */
  router.post('/backfill-return-counts', authRequired, ownerRequired, async (req, res) => {
    if (!isDbReady()) {
      return res.status(503).json({ error: 'Database not ready' });
    }
    try {
      const query = {
        $or: [
          { returnUpcs: { $exists: true, $ne: [] } },
          { verifiedReturnUpcs: { $exists: true, $ne: [] } }
        ]
      };

      const cursor = Order.find(query)
        .select('_id returnUpcs returnUpcCounts verifiedReturnUpcs verifiedReturnUpcCounts')
        .lean()
        .cursor();

      let scanned = 0;
      let updated = 0;
      let bulkOps = [];

      for await (const doc of cursor) {
        scanned += 1;
        const updates = buildReturnCountUpdates(doc);
        if (Object.keys(updates).length === 0) continue;

        updated += 1;
        bulkOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: updates }
          }
        });

        if (bulkOps.length >= 500) {
          await Order.bulkWrite(bulkOps);
          bulkOps = [];
        }
      }

      if (bulkOps.length > 0) {
        await Order.bulkWrite(bulkOps);
      }

      await recordAuditLog({
        type: 'ORDER_RETURN_BACKFILL',
        actorId: req.user?.username || req.user?.id || 'UNKNOWN',
        details: `Backfilled return counts for ${updated} orders (${scanned} scanned).`
      });

      res.json({ ok: true, scanned, updated });
    } catch (err) {
      console.error('BACKFILL RETURN COUNTS ERROR:', err);
      res.status(500).json({ error: 'Failed to backfill return counts' });
    }
  });

  /**
   * POST /api/orders/release-reservation
   * Option A: cancel redirect restocks immediately.
   * Idempotent: guarded by inventoryReleasedAt and terminal statuses.
   */
  router.post('/release-reservation', async (req, res) => {
    if (!isDbReady()) {
      return res.status(503).json({ error: 'Database not ready' });
    }
    const sessionDb = await mongoose.startSession();
    try {
      const sessionId = String(req.body?.sessionId || '').trim();
      if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

      await sessionDb.withTransaction(async () => {
        const order = await Order.findOne({ stripeSessionId: sessionId }).session(sessionDb);
        if (!order) return;

        // This handles both credit release and inventory restock.
        await releaseCreditAuthorization(order, sessionDb);

        if (order.status === 'PAID') return;

        order.status = 'CANCELED';
        order.inventoryReleasedAt = new Date();
        order.canceledAt = new Date();
        order.cancelReason = order.cancelReason || 'cancel_redirect';

        await order.save({ session: sessionDb });

        // best-effort void
        await voidStripeAuthorizationBestEffort(stripe, order);
      }, { maxCommitTimeMS: 10000 });

      res.json({ ok: true });
    } catch (err) {
      console.error('RELEASE RESERVATION ERROR:', err);
      res.status(500).json({ error: 'Failed to release reservation' });
    } finally {
      sessionDb.endSession();
    }
  });

  /**
   * PATCH /api/orders/:id (owner-only)
   * - Accepts frontend statuses, including CLOSED (manual cancel).
   * - CLOSED -> immediately restocks and sets DB status to CANCELED, and voids Stripe authorization if present.
   */
  router.patch('/:id', authRequired, async (req, res) => {
    if (!isDbReady()) {
      return res.status(503).json({ error: 'Database not ready' });
    }
    const sessionDb = await mongoose.startSession();
    try {
      const orderId = String(req.params.id || '').trim();
      if (!orderId) return res.status(400).json({ error: 'Invalid order id' });

      const isOwner = isOwnerUsername(req.user?.username);
      const isDriver = isDriverUsername(req.user?.username);

      if (!isOwner && !isDriver) {
        return res.status(403).json({ error: 'Staff access required' });
      }

      const ownerAllowed = [
        'status',
        'driverId',
        'address',
        'gpsCoords',
        'verificationPhoto',
        'returnPhoto',
        'verifiedReturnCredit',
        'verifiedReturnCreditGross',
        'creditAuthorizedCents',
        'verifiedReturnUpcs',
        'verifiedReturnUpcCounts',
        'creditAppliedCents',
        'returnPayoutMethod'
      ];
      const driverAllowed = [
        'status',
        'driverId',
        'gpsCoords',
        'verificationPhoto',
        'returnPhoto',
        'verifiedReturnUpcs',
        'verifiedReturnUpcCounts',
        'returnPayoutMethod'
      ];

      const updates = {};
      const allowed = isOwner ? ownerAllowed : driverAllowed;
      for (const k of allowed) {
        if (req.body?.[k] !== undefined) updates[k] = req.body[k];
      }
      if (updates.returnPayoutMethod !== undefined) {
        updates.returnPayoutMethod = normalizeReturnPayoutMethod(updates.returnPayoutMethod);
      }
      if (updates.verifiedReturnUpcCounts !== undefined || updates.verifiedReturnUpcs !== undefined) {
        const payload =
          updates.verifiedReturnUpcCounts !== undefined
            ? updates.verifiedReturnUpcCounts
            : updates.verifiedReturnUpcs;
        const normalized = normalizeUpcCounts(payload);
        updates.verifiedReturnUpcCounts = normalized.upcCounts;
        updates.verifiedReturnUpcs = normalized.flattened;
      }

      const requestedStatus = updates.status ? String(updates.status).trim() : null;

      // Manual cancel from frontend typically sends CLOSED.
      const isManualCancel = requestedStatus === 'CLOSED' || requestedStatus === 'CANCELED';

      if (isManualCancel && !isOwner) {
        return res.status(403).json({ error: 'Owner access required' });
      }

      if (isManualCancel) {
        let updatedOrderDoc = null;

        await sessionDb.withTransaction(async () => {
          const order = await Order.findOne({ orderId }).session(sessionDb);
          if (!order) return;
 
          // Allow canceling PAID orders if they are just credit-authorized
          if (order.status === 'PAID' && order.paymentMethod !== 'CREDITS') {
            const e = new Error('Cannot cancel a PAID order (refund flow required).');
            e.code = 'CANNOT_CANCEL_PAID';
            throw e;
          }

          await releaseCreditAuthorization(order, sessionDb);

          // Already released/canceled/expired => idempotent return
          if (order.inventoryReleasedAt || order.status === 'CANCELED' || order.status === 'EXPIRED') {
            updatedOrderDoc = order;
            return;
          }

          // await restockOrderItems(order, sessionDb); // restock is now part of releaseCreditAuthorization

          order.status = 'CANCELED';
          order.inventoryReleasedAt = new Date();
          order.canceledAt = new Date();
          order.cancelReason = order.cancelReason || 'manual_owner_cancel';

          if (updates.driverId !== undefined) order.driverId = String(updates.driverId || '');
          if (updates.address !== undefined) order.address = String(updates.address || '');
          if (updates.gpsCoords !== undefined) order.gpsCoords = updates.gpsCoords;
          if (updates.verificationPhoto !== undefined)
            order.verificationPhoto = String(updates.verificationPhoto || '');
          if (updates.returnPhoto !== undefined)
            order.returnPhoto = String(updates.returnPhoto || '');

          if (updates.verifiedReturnCredit !== undefined) {
            const v = Number(updates.verifiedReturnCredit);
            order.verifiedReturnCredit = Number.isFinite(v) ? Math.max(0, v) : 0;
            if (updates.verifiedReturnCreditGross === undefined) {
              order.verifiedReturnCreditGross = order.verifiedReturnCredit;
            }
          }

          await order.save({ session: sessionDb });
          updatedOrderDoc = order;
        }, { maxCommitTimeMS: 10000 });

        if (!updatedOrderDoc) return res.status(404).json({ error: 'Order not found' });

        await voidStripeAuthorizationBestEffort(stripe, updatedOrderDoc);
        await recordAuditLog({
          type: 'ORDER_CANCELED',
          actorId: req.user?.username || req.user?.id || 'UNKNOWN',
          details: `Order ${orderId} canceled by owner.`
        });

        return res.json({ ok: true, order: mapOrderForFrontend(updatedOrderDoc) });
      }

      if (isOwner) {
        if (requestedStatus === 'DELIVERED') {
          updates.deliveredAt = new Date();
        }
        if (requestedStatus === 'PAID') {
          updates.paidAt = new Date();
        }

        if (updates.verifiedReturnCredit !== undefined) {
          updates.verifiedReturnCredit = Math.max(0, Number(updates.verifiedReturnCredit || 0));
          if (updates.verifiedReturnCreditGross === undefined) {
            updates.verifiedReturnCreditGross = updates.verifiedReturnCredit;
          }
        }
        if (updates.verifiedReturnCreditGross !== undefined) {
          updates.verifiedReturnCreditGross = Math.max(
            0,
            Number(updates.verifiedReturnCreditGross || 0)
          );
        }
        if (updates.creditAuthorizedCents !== undefined) {
          updates.creditAuthorizedCents = Math.max(
            0,
            Math.round(Number(updates.creditAuthorizedCents || 0))
          );
        }
        if (updates.creditAppliedCents !== undefined) {
          updates.creditAppliedCents = Math.max(
            0,
            Math.round(Number(updates.creditAppliedCents || 0))
          );
        }

        const updated = await Order.findOneAndUpdate({ orderId }, updates, {
          new: true
        }).lean();

        if (!updated) return res.status(404).json({ error: 'Order not found' });

        if (requestedStatus) {
          await recordAuditLog({
            type: 'ORDER_UPDATED',
            actorId: req.user?.username || req.user?.id || 'UNKNOWN',
            details: `Order ${orderId} updated to status ${requestedStatus}.`
          });
        }

        // 🚀 Emit WebSocket event for real-time sync
        const mappedOrder = mapOrderForFrontend(updated);
        if (req.app.locals.io && updated.customerId) {
          req.app.locals.io.to(`user:${updated.customerId}`).emit('order:updated', mappedOrder);
        }

        return res.json({ ok: true, order: mappedOrder });
      }

      let updatedOrderDoc = null;
      const driverId = req.user?.username || req.user?.id;
      let creditedUserId = null;
      let creditedAmount = 0;
      let cashPayoutUserId = null;
      let cashPayoutAmount = 0;

      await sessionDb.withTransaction(async () => {
        const order = await Order.findOne({ orderId }).session(sessionDb);
        if (!order) return;

        const returnCount =
          Array.isArray(order.returnUpcCounts) && order.returnUpcCounts.length > 0
            ? order.returnUpcCounts.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0)
            : order.returnUpcs?.length ?? 0;
        const isReturnOnly = (order.items?.length ?? 0) === 0 && returnCount > 0;

        const isAssignedDriver =
          order.driverId &&
          [req.user?.username, req.user?.id].includes(order.driverId);

        if (!requestedStatus && !isAssignedDriver) {
          const e = new Error('Order is not assigned to this driver.');
          e.code = 'DRIVER_MISMATCH';
          throw e;
        }

        if (updates.returnPayoutMethod !== undefined) {
          order.returnPayoutMethod = updates.returnPayoutMethod;
        }

        if (requestedStatus === 'ASSIGNED') {
          if (!driverId) {
            const e = new Error('Driver ID missing.');
            e.code = 'DRIVER_ID_REQUIRED';
            throw e;
          }

          const assignableStatuses = ['PENDING', 'PAID', 'AUTHORIZED'];
          if (!assignableStatuses.includes(order.status)) {
            const e = new Error('Order is not available for assignment.');
            e.code = 'INVALID_ASSIGNMENT';
            throw e;
          }

          if (order.driverId && order.driverId !== driverId) {
            const e = new Error('Order already assigned to another driver.');
            e.code = 'ALREADY_ASSIGNED';
            throw e;
          }

          order.status = 'ASSIGNED';
          order.driverId = driverId;
        } else if (requestedStatus === 'PICKED_UP') {
          if (!isAssignedDriver || order.status !== 'ASSIGNED') {
            const e = new Error('Order must be assigned before pickup.');
            e.code = 'INVALID_PICKUP';
            throw e;
          }
          order.status = 'PICKED_UP';
        } else if (requestedStatus === 'ARRIVING') {
          if (!isAssignedDriver || !['PICKED_UP', 'ARRIVING'].includes(order.status)) {
            const e = new Error('Order must be picked up before navigation.');
            e.code = 'INVALID_NAV';
            throw e;
          }
          order.status = 'ARRIVING';
        } else if (requestedStatus === 'DELIVERED') {
          if (!isAssignedDriver || !['PICKED_UP', 'ARRIVING'].includes(order.status)) {
            const e = new Error('Order must be en route before delivery.');
            e.code = 'INVALID_DELIVERY';
            throw e;
          }
          order.status = 'DELIVERED';
          order.deliveredAt = new Date();

          // Capture authorized credits
          if (order.creditAuthorizedCents > 0 && !order.creditAppliedAt) {
            const user = await User.findById(order.customerId).session(sessionDb);
            if (user) {
              const authorizedAmount = Number(order.creditAuthorizedCents || 0) / 100;
              const currentAuthorizedBalance = Number(user.authorizedCreditBalance || 0);

              user.authorizedCreditBalance = Math.max(0, currentAuthorizedBalance - authorizedAmount);
              await user.save({ session: sessionDb });

              order.creditAppliedCents = Math.round(Number(order.creditAuthorizedCents || 0));
              order.creditAppliedAt = new Date();

              // If fully paid by credits, mark as PAID now.
              if (order.paymentMethod === 'CREDITS') {
                order.status = 'PAID';
                order.paidAt = new Date();
              }
            }
          }

          if (isReturnOnly && !order.returnCreditsAppliedAt) {
            const verifiedPayload =
              updates.verifiedReturnUpcCounts ??
              updates.verifiedReturnUpcs ??
              order.verifiedReturnUpcCounts ??
              order.verifiedReturnUpcs ??
              order.returnUpcCounts ??
              order.returnUpcs ??
              [];
            const normalized = normalizeUpcCounts(verifiedPayload);
            const uniqueReturnUpcs = normalized.uniqueUpcs;
            const payoutMethod = normalizeReturnPayoutMethod(order.returnPayoutMethod);
            let verifiedReturnCreditGross = 0;
            if (uniqueReturnUpcs.length > 0) {
              const upcEntries = await UpcItem.find({
                upc: { $in: uniqueReturnUpcs },
                isEligible: true
              })
                .session(sessionDb)
                .lean();

              verifiedReturnCreditGross = sumReturnCredits(normalized.upcCounts, upcEntries);
              let feeSummary = { totalFee: 0 };
              if (payoutMethod === 'CASH') {
                const feeConfig = await getReturnFeeConfig();
                feeSummary = calculateReturnFeeSummary(
                  normalized.upcCounts,
                  upcEntries,
                  feeConfig
                );
              }
              const netCredit =
                payoutMethod === 'CASH'
                  ? Math.max(0, verifiedReturnCreditGross - feeSummary.totalFee)
                  : verifiedReturnCreditGross;
              order.verifiedReturnCreditGross = verifiedReturnCreditGross;
              order.verifiedReturnCredit = netCredit;
            } else {
              order.verifiedReturnCreditGross = 0;
              order.verifiedReturnCredit = 0;
            }

            order.verifiedReturnUpcs = normalized.flattened;
            order.verifiedReturnUpcCounts = normalized.upcCounts;
            order.returnCreditsAppliedAt = new Date();

            if (payoutMethod === 'CREDIT') {
              if (
                order.customerId &&
                order.customerId !== 'GUEST' &&
                order.verifiedReturnCredit > 0
              ) {
                const user = await User.findById(order.customerId).session(sessionDb);
                if (user) {
                  const previousCredits = Number(user.creditBalance || 0);
                  user.creditBalance = Math.max(0, previousCredits + order.verifiedReturnCredit);
                  await user.save({ session: sessionDb });

                  const delta = Number(user.creditBalance || 0) - previousCredits;
                  if (delta) {
                    await LedgerEntry.create(
                      [
                        {
                          userId: order.customerId,
                          delta,
                          reason: `RETURN_ONLY_CREDIT:${order.orderId}`
                        }
                      ],
                      { session: sessionDb }
                    );
                    creditedUserId = order.customerId;
                    creditedAmount = delta;
                  }
                }
              }
            } else if (payoutMethod === 'CASH' && order.verifiedReturnCredit > 0) {
              await CashPayout.create(
                [
                  {
                    orderId: order.orderId,
                    userId: order.customerId,
                    driverId: order.driverId || '',
                    amount: order.verifiedReturnCredit,
                    createdBy: req.user?.username || req.user?.id || ''
                  }
                ],
                { session: sessionDb }
              );
              cashPayoutUserId = order.customerId;
              cashPayoutAmount = order.verifiedReturnCredit;
            }
          }
        }

        if (updates.gpsCoords !== undefined) order.gpsCoords = updates.gpsCoords;
        if (updates.verificationPhoto !== undefined) {
          order.verificationPhoto = String(updates.verificationPhoto || '');
        }
        if (updates.returnPhoto !== undefined) {
          order.returnPhoto = String(updates.returnPhoto || '');
        }

        await order.save({ session: sessionDb });
        updatedOrderDoc = order;
      }, { maxCommitTimeMS: 10000 });

      if (!updatedOrderDoc) return res.status(404).json({ error: 'Order not found' });

      if (requestedStatus) {
        await recordAuditLog({
          type: 'ORDER_UPDATED',
          actorId: req.user?.username || req.user?.id || 'UNKNOWN',
          details: `Order ${orderId} updated to status ${requestedStatus} by driver.`
        });
      }
      if (creditedUserId && creditedAmount) {
        await recordAuditLog({
          type: 'CREDIT_ADJUSTED',
          actorId: req.user?.username || req.user?.id || 'UNKNOWN',
          details: `Applied $${creditedAmount.toFixed(2)} return credits for order ${orderId}.`
        });
      }
      if (cashPayoutUserId && cashPayoutAmount) {
        await recordAuditLog({
          type: 'ORDER_UPDATED',
          actorId: req.user?.username || req.user?.id || 'UNKNOWN',
          details: `Recorded $${cashPayoutAmount.toFixed(2)} cash payout for order ${orderId}.`
        });
      }

      // 🚀 Emit WebSocket event for real-time sync
      const mappedOrder = mapOrderForFrontend(updatedOrderDoc);
      if (req.app.locals.io && updatedOrderDoc.customerId) {
        req.app.locals.io.to(`user:${updatedOrderDoc.customerId}`).emit('order:updated', mappedOrder);
      }

      res.json({ ok: true, order: mappedOrder });
    } catch (err) {
      if (err?.code === 'CANNOT_CANCEL_PAID') {
        return res.status(400).json({ error: err.message });
      }
      if (
        [
          'DRIVER_ID_REQUIRED',
          'INVALID_ASSIGNMENT',
          'ALREADY_ASSIGNED',
          'INVALID_PICKUP',
          'INVALID_NAV',
          'INVALID_DELIVERY',
          'DRIVER_MISMATCH'
        ].includes(err?.code)
      ) {
        return res.status(400).json({ error: err.message });
      }
      console.error('PATCH ORDER ERROR:', err);
      res.status(500).json({ error: 'Failed to update order' });
    } finally {
      sessionDb.endSession();
    }
  });

  return router;
};

export default createOrdersRouter;
