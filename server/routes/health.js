import express from 'express';

const router = express.Router();

router.get('/', (_, res) => {
  res.send('NINPO MAINFRAME ONLINE');
});

router.get('/api/sync', (_, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

export default router;
