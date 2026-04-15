import { isDbReady } from '../db/connect.js';

export const getHealth = (_, res) => {
  if (isDbReady()) {
    res.send('NINPO MAINFRAME ONLINE');
  } else {
    res.status(503).send('Database not ready');
  }
};

export const getApiSync = (_, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
};