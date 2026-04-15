import express from 'express';

import { calculateDistance } from '../controllers/distance.js';

const router = express.Router();

router.post('/', calculateDistance);

export default router;
