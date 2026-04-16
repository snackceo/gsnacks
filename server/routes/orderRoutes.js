const express = require('express');
const {
  addOrderItems,
  getOrderById,
  getMyOrders,
  getOrders,
  updateOrderStatus,
  assignDriverToOrder,
  getAssignedOrders,
  updateDriverLocation,
} = require('../controllers/orderController.js');

const router = express.Router();

// Nested Payment Router
router.use('/:orderId', require('./paymentRoutes.js'));

const { protect, authorize } = require('../middleware/auth.js');

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

module.exports = router;