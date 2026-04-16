import { isDbReady } from '../db/connect.js';

const dbReady = (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  next();
};

export default dbReady;
