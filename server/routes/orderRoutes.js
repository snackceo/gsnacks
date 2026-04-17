import express from 'express';
import {
  addOrderItems,
  getOrderById,
  getMyOrders,
  getOrders,
  updateOrderStatus,
  assignDriverToOrder,
  getAssignedOrders,
  updateDriverLocation,
} from '../controllers/orderController.js';

const router = express.Router();

// Nested Payment Router
import paymentRoutes from './paymentRoutes.js';
router.use('/:orderId', paymentRoutes);

import { protect, authorize } from '../middleware/auth.js';

router
  .route('/')
  .post(protect, authorize('customer'), addOrderItems)
  .get(protect, authorize('admin', 'owner'), getOrders);

router
  .route('/assigned')
  .get(protect, authorize('driver'), getAssignedOrders);

router.route('/myorders').get(protect, authorize('customer'), getMyOrders);

router.route('/:id').get(protect, getOrderById);

router
  .route('/:id/status')
  .put(protect, authorize('admin', 'owner', 'driver'), updateOrderStatus);

router
  .route('/:id/assign')
  .put(protect, authorize('admin', 'owner'), assignDriverToOrder);

router
  .route('/:id/location')
  .put(protect, authorize('driver'), updateDriverLocation);

export default router;