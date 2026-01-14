import AppSettings from '../models/AppSettings.js';

const parseCoordinate = value => {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return number;
};

const getHubCoords = async () => {
  const settings = await AppSettings.findOne({ key: 'default' }).lean();
  const settingsLat = parseCoordinate(settings?.hubLat);
  const settingsLng = parseCoordinate(settings?.hubLng);
  const envLat = parseCoordinate(process.env.HUB_LAT);
  const envLng = parseCoordinate(process.env.HUB_LNG);

  const hubLat = Number.isFinite(settingsLat) ? settingsLat : envLat;
  const hubLng = Number.isFinite(settingsLng) ? settingsLng : envLng;

  if (!Number.isFinite(hubLat) || !Number.isFinite(hubLng)) {
    const error = new Error('Hub coordinates are not configured.');
    error.code = 'HUB_NOT_CONFIGURED';
    throw error;
  }

  return { lat: hubLat, lng: hubLng };
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

const resolveDistanceMiles = async address => {
  const trimmedAddress = String(address || '').trim();
  if (!trimmedAddress) {
    const error = new Error('Address is required for distance lookup.');
    error.code = 'ADDRESS_REQUIRED';
    throw error;
  }

  const hub = await getHubCoords();

  const destination = await geocodeAddress(trimmedAddress);
  if (!destination) {
    const error = new Error('Address could not be geocoded.');
    error.code = 'ADDRESS_NOT_FOUND';
    throw error;
  }

  return haversineMiles(hub, destination);
};

export { resolveDistanceMiles };
