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

const getMapsApiKey = () => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const error = new Error('Google Maps API key is not configured.');
    error.code = 'MAPS_API_KEY_MISSING';
    throw error;
  }
  return apiKey;
};

const resolveDistanceMiles = async address => {
  const trimmedAddress = String(address || '').trim();
  if (!trimmedAddress) {
    const error = new Error('Address is required for distance lookup.');
    error.code = 'ADDRESS_REQUIRED';
    throw error;
  }

  const hub = await getHubCoords();
  const apiKey = getMapsApiKey();

  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', `${hub.lat},${hub.lng}`);
  url.searchParams.set('destinations', trimmedAddress);
  url.searchParams.set('units', 'imperial');
  url.searchParams.set('key', apiKey);

  try {
    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== 'OK') {
      const errorMessage = data.error_message || `Distance Matrix API error: ${data.status}`;
      const error = new Error(errorMessage);
      if (data.status === 'NOT_FOUND' || data.status === 'ZERO_RESULTS') {
        error.code = 'ADDRESS_NOT_FOUND';
      } else {
        error.code = 'MAPS_API_ERROR';
      }
      throw error;
    }

    const element = data.rows?.[0]?.elements?.[0];

    if (element?.status !== 'OK') {
      const error = new Error(`Could not determine distance to address: ${element.status}`);
      error.code = 'ADDRESS_NOT_FOUND';
      throw error;
    }

    const distanceMeters = element.distance?.value;
    if (typeof distanceMeters !== 'number') {
      throw new Error('Invalid distance value in API response.');
    }

    // Convert meters to miles
    const distanceMiles = distanceMeters / 1609.34;
    return distanceMiles;

  } catch (err) {
    if (err.code) throw err; // Re-throw errors with specific codes
    console.error('Google Maps API request failed:', err);
    throw new Error('Distance lookup failed due to a network or API error.');
  }
};

export { resolveDistanceMiles };
