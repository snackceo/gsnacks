import express from 'express';

const router = express.Router();

const getHubCoords = () => {
  const lat = Number(process.env.HUB_LAT);
  const lng = Number(process.env.HUB_LNG);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
};

const toRadians = value => (value * Math.PI) / 180;

const haversineMiles = (from, to) => {
  const earthRadiusMiles = 3958.8;
  const latDelta = toRadians(to.lat - from.lat);
  const lngDelta = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
};

const geocodeAddress = async address => {
  const query = encodeURIComponent(address);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${query}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'NinpoSnacksDistanceLookup/1.0 (ops@ninposnacks.com)'
    }
  });

  if (!response.ok) {
    throw new Error('Failed to reach geocoding service');
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const candidate = data[0];
  const lat = Number(candidate?.lat);
  const lng = Number(candidate?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

router.post('/', async (req, res) => {
  try {
    const address = String(req.body?.address || '').trim();
    if (!address) {
      return res.status(400).json({ error: 'Address is required for distance lookup.' });
    }

    const hub = getHubCoords();
    if (!hub) {
      return res.status(503).json({ error: 'Hub coordinates are not configured.' });
    }

    const destination = await geocodeAddress(address);
    if (!destination) {
      return res.status(404).json({ error: 'Address could not be geocoded.' });
    }

    const distanceMiles = haversineMiles(hub, destination);
    const roundedMiles = Math.floor(distanceMiles * 10) / 10;
    return res.json({
      distanceMiles,
      roundedMiles
    });
  } catch (err) {
    console.error('DISTANCE LOOKUP ERROR:', err);
    return res.status(500).json({ error: 'Distance lookup failed.' });
  }
});

export default router;
