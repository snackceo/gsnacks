import express from 'express';
import {
  createReturnRequest,
  getReturnRequests,
  getMyReturnRequests,
  reviewReturnRequest,
} from '../controllers/bottleReturnController.js';

const router = express.Router();

import { protect, authorize } from '../middleware/auth.js';

router
  .route('/')
  .post(protect, authorize('customer'), createReturnRequest)
  .get(protect, authorize('admin', 'owner'), getReturnRequests);

router.route('/myreturns').get(protect, authorize('customer'), getMyReturnRequests);

router.route('/:id/review').put(protect, authorize('admin', 'owner'), reviewReturnRequest);

export default router;