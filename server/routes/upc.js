import express from 'express';
import rateLimit from 'express-rate-limit';

import { authRequired, ownerRequired } from '../utils/helpers.js';
import {
  getEligibility,
  postEligibility,
  getOffLookup,
  getUpcEligibility,
  getUpcItems,
  upsertUpcItem,
  scanUpc,
  linkUpc,
  patchUpcItem,
  deleteUpcItem
} from '../controllers/upc.js';

const router = express.Router();

const offLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many UPC lookup requests. Please try again in a minute.'
    });
  }
});

router.get('/eligibility', getEligibility);
router.post('/eligibility', postEligibility);
router.get('/off/:code', offLookupLimiter, authRequired, ownerRequired, getOffLookup);
router.get('/eligibility/:upc', getUpcEligibility);
router.get('/', authRequired, ownerRequired, getUpcItems);
router.post('/', authRequired, ownerRequired, upsertUpcItem);
router.post('/scan', authRequired, ownerRequired, scanUpc);
router.post('/link', authRequired, ownerRequired, linkUpc);
router.patch('/:upc', authRequired, ownerRequired, patchUpcItem);
router.delete('/:upc', authRequired, ownerRequired, deleteUpcItem);

export default router;
