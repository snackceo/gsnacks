const express = require('express');
const { createCheckoutSession } = require('../controllers/paymentController.js');
const { protect, authorize } = require('../middleware/auth.js');

const router = express.Router({ mergeParams: true });

router
  .route('/checkout-session')
  .post(protect, authorize('customer'), createCheckoutSession);

module.exports = router;