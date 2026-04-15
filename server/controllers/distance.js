import { resolveDistanceMiles } from '../utils/distance.js';

export const calculateDistance = async (req, res) => {
  try {
    const distanceMiles = await resolveDistanceMiles(req.body?.address);
    const roundedMiles = Math.floor(distanceMiles * 10) / 10;
    return res.json({
      distanceMiles,
      roundedMiles
    });
  } catch (err) {
    console.error('DISTANCE LOOKUP ERROR:', err);
    if (err?.code === 'ADDRESS_REQUIRED') {
      return res.status(400).json({ error: err.message });
    }
    if (err?.code === 'HUB_NOT_CONFIGURED') {
      return res.status(503).json({ error: err.message });
    }
    if (err?.code === 'ADDRESS_NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Distance lookup failed.' });
  }
};