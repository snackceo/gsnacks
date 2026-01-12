import express from 'express';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import UpcItem from '../models/UpcItem.js';
import User from '../models/User.js';
import LedgerEntry from '../models/LedgerEntry.js';
import {
  authRequired,
  buildReturnCountUpdates,
  isDriverUsername,
  isOwnerUsername,
  mapOrderForFrontend,
  normalizeUpcCounts,
  restockOrderItems,
  voidStripeAuthorizationBestEffort
} from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';

const RETURN_PROCESSING_FEE_PERCENT = Math.max(
  0,
  Math.min(100, Number(process.env.RETURN_PROCESSING_FEE_PERCENT ?? 20))
);

const applyReturnProcessingFee = (grossCredit, { waive } = {}) => {
  const grossCents = Math.max(0, Math.round(Number(grossCredit || 0) * 100));
  if (waive) {
    return {
      gross: grossCents / 100,
      net: grossCents / 100
    };
  }
  const netCents = Math.max(
    0,
    Math.round(grossCents * (1 - RETURN_PROCESSING_FEE_PERCENT / 100))
  );
  return {
    gross: grossCents / 100,
    net: netCents / 100
  };
};

const createOrdersRouter = ({ stripe }) => {
  const router = express.Router();

  /* =========================
     ORDERS
     - Owner sees all
     - Customers see their own
  ========================= */
  router.get('/', authRequired, async (req, res) => {
    try {
      const isOwner = isOwnerUsername(req.user?.username);
      const isDriver = isDriverUsername(req.user?.username);
      const q = isOwner
        ? {}
        : isDriver
          ? { driverId: req.user?.username || req.user?.id }
          : { customerId: req.user?.id };

      const docs = await Order.find(q).sort({ createdAt: -1 }).lean();
      const backfillOps = [];
      for (const doc of docs) {
        const updates = buildReturnCountUpdates(doc);
        if (Object.keys(updates).length > 0) {
          backfillOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: { $set: updates }
            }
          });
          Object.assign(doc, updates);
        }
      }
      if (backfillOps.length > 0) {
        await Order.bulkWrite(backfillOps);
      }

      const orders = docs.map(mapOrderForFrontend);

      res.json({ ok: true, orders });
    } catch (err) {
      console.error('GET ORDERS ERROR:', err);
      res.status(500).json({ error: 'Failed to load orders' });
    }
  });

  /**
   * POST /api/orders/release-reservation
   * Option A: cancel redirect restocks immediately.
   * Idempotent: guarded by inventoryReleasedAt and terminal statuses.
   */
  router.post('/release-reservation', async (req, res) => {
    const sessionDb = await mongoose.startSession();

    try {
      const sessionId = String(req.body?.sessionId || '').trim();
      if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

      await sessionDb.withTransaction(async () => {
        const order = await Order.findOne({ stripeSessionId: sessionId }).session(sessionDb);
        if (!order) return;

        if (order.status === 'PAID') return;
        if (order.inventoryReleasedAt) return;

        await restockOrderItems(order, sessionDb);

        order.status = 'CANCELED';
        order.inventoryReleasedAt = new Date();
        order.canceledAt = new Date();
        order.cancelReason = order.cancelReason || 'cancel_redirect';

        await order.save({ session: sessionDb });

        // best-effort void
        await voidStripeAuthorizationBestEffort(stripe, order);
      });

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
        'verifiedReturnCredit',
        'verifiedReturnCreditGross',
        'verifiedReturnUpcs',
        'verifiedReturnUpcCounts',
        'creditApplied'
      ];
      const driverAllowed = [
        'status',
        'driverId',
        'gpsCoords',
        'verificationPhoto',
        'verifiedReturnUpcs',
        'verifiedReturnUpcCounts'
      ];

      const updates = {};
      const allowed = isOwner ? ownerAllowed : driverAllowed;
      for (const k of allowed) {
        if (req.body?.[k] !== undefined) updates[k] = req.body[k];
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

          if (order.status === 'PAID') {
            const e = new Error('Cannot cancel a PAID order (refund flow required).');
            e.code = 'CANNOT_CANCEL_PAID';
            throw e;
          }

          // Already released/canceled/expired => idempotent return
          if (order.inventoryReleasedAt || order.status === 'CANCELED' || order.status === 'EXPIRED') {
            updatedOrderDoc = order;
            return;
          }

          await restockOrderItems(order, sessionDb);

          order.status = 'CANCELED';
          order.inventoryReleasedAt = new Date();
          order.canceledAt = new Date();
          order.cancelReason = order.cancelReason || 'manual_owner_cancel';

          if (updates.driverId !== undefined) order.driverId = String(updates.driverId || '');
          if (updates.address !== undefined) order.address = String(updates.address || '');
          if (updates.gpsCoords !== undefined) order.gpsCoords = updates.gpsCoords;
          if (updates.verificationPhoto !== undefined)
            order.verificationPhoto = String(updates.verificationPhoto || '');

          if (updates.verifiedReturnCredit !== undefined) {
            const v = Number(updates.verifiedReturnCredit);
            order.verifiedReturnCredit = Number.isFinite(v) ? Math.max(0, v) : 0;
            if (updates.verifiedReturnCreditGross === undefined) {
              order.verifiedReturnCreditGross = order.verifiedReturnCredit;
            }
          }

          await order.save({ session: sessionDb });
          updatedOrderDoc = order;
        });

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
        if (updates.creditApplied !== undefined) {
          updates.creditApplied = Math.max(0, Number(updates.creditApplied || 0));
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

        return res.json({ ok: true, order: mapOrderForFrontend(updated) });
      }

      let updatedOrderDoc = null;
      const driverId = req.user?.username || req.user?.id;
      let creditedUserId = null;
      let creditedAmount = 0;

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
          [order.driverId, req.user?.username, req.user?.id].includes(order.driverId);

        if (!requestedStatus && !isAssignedDriver) {
          const e = new Error('Order is not assigned to this driver.');
          e.code = 'DRIVER_MISMATCH';
          throw e;
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
            const countMap = new Map(
              normalized.upcCounts.map(entry => [entry.upc, entry.quantity])
            );
            let verifiedReturnCreditGross = 0;
            if (uniqueReturnUpcs.length > 0) {
              const upcEntries = await UpcItem.find({
                upc: { $in: uniqueReturnUpcs },
                isEligible: true
              })
                .session(sessionDb)
                .lean();

              verifiedReturnCreditGross = upcEntries.reduce((sum, entry) => {
                const count = countMap.get(entry?.upc) || 0;
                return sum + Number(entry?.depositValue || 0) * count;
              }, 0);
            }

            const verifiedCredit = applyReturnProcessingFee(verifiedReturnCreditGross, {
              waive: true
            });

            order.verifiedReturnUpcs = normalized.flattened;
            order.verifiedReturnUpcCounts = normalized.upcCounts;
            order.verifiedReturnCreditGross = verifiedCredit.gross;
            order.verifiedReturnCredit = verifiedCredit.net;
            order.returnCreditsAppliedAt = new Date();

            if (order.customerId && order.customerId !== 'GUEST' && verifiedCredit.net > 0) {
              const user = await User.findById(order.customerId).session(sessionDb);
              if (user) {
                const previousCredits = Number(user.creditBalance || 0);
                user.creditBalance = Math.max(0, previousCredits + verifiedCredit.net);
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
          }
        }

        if (updates.gpsCoords !== undefined) order.gpsCoords = updates.gpsCoords;
        if (updates.verificationPhoto !== undefined) {
          order.verificationPhoto = String(updates.verificationPhoto || '');
        }

        await order.save({ session: sessionDb });
        updatedOrderDoc = order;
      });

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

      res.json({ ok: true, order: mapOrderForFrontend(updatedOrderDoc) });
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
