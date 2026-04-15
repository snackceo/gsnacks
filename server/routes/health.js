import express from 'express';

const router = express.Router();

import { getHealth, getApiSync } from '../controllers/health.js';

router.get('/', getHealth);

router.get('/api/sync', getApiSync);

export default router;
