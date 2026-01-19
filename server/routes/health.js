import express from 'express';

const router = express.Router();


import { isDbReady } from '../db/connect.js';

router.get('/', (_, res) => {
  if (isDbReady()) {
    res.send('NINPO MAINFRAME ONLINE');
  } else {
    res.status(503).send('Database not ready');
  }
});

router.get('/api/sync', (_, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

export default router;
