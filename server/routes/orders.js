import express from 'express';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import {
  authRequired,
  isDriverUsername,
  isOwnerUsername,
  mapOrderForFrontend,
  restockOrderItems,
  voidStripeAuthorizationBestEffort
} from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';

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
        'creditApplied'
      ];
      const driverAllowed = ['status', 'driverId', 'gpsCoords', 'verificationPhoto'];

      const updates = {};
      const allowed = isOwner ? ownerAllowed : driverAllowed;
      for (const k of allowed) {
        if (req.body?.[k] !== undefined) updates[k] = req.body[k];
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

      await sessionDb.withTransaction(async () => {
        const order = await Order.findOne({ orderId }).session(sessionDb);
        if (!order) return;

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
