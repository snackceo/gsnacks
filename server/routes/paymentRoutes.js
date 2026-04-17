import express from 'express';
import { createCheckoutSession } from '../controllers/paymentController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router({ mergeParams: true });

router
  .route('/checkout-session')
  .post(protect, authorize('customer'), createCheckoutSession);

export default router;