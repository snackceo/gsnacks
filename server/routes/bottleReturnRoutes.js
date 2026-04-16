const express = require('express');
const {
  createReturnRequest,
  getReturnRequests,
  getMyReturnRequests,
  reviewReturnRequest,
} = require('../controllers/bottleReturnController.js');

const router = express.Router();

const { protect, authorize } = require('../middleware/auth.js');

router
  .route('/')
  .post(protect, authorize('customer'), createReturnRequest)
  .get(protect, authorize('admin', 'owner'), getReturnRequests);

router.route('/myreturns').get(protect, authorize('customer'), getMyReturnRequests);

router.route('/:id/review').put(protect, authorize('admin', 'owner'), reviewReturnRequest);

module.exports = router;