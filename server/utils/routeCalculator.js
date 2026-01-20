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

const calculateRoute = async (waypoints) => {
    if (!waypoints || waypoints.length < 2) {
        throw new Error('At least two waypoints are required to calculate a route.');
    }

    const apiKey = getMapsApiKey();
    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const intermediateWaypoints = waypoints.slice(1, -1).join('|');

    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    if (intermediateWaypoints) {
        url.searchParams.set('waypoints', intermediateWaypoints);
    }
    url.searchParams.set('key', apiKey);

    try {
        const response = await fetch(url.toString());
        const data = await response.json();

        if (data.status !== 'OK') {
            const errorMessage = data.error_message || `Directions API error: ${data.status}`;
            const error = new Error(errorMessage);
            error.code = 'MAPS_API_ERROR';
            throw error;
        }

        const route = data.routes[0];
        if (!route) {
            throw new Error('No routes found.');
        }

        let totalDistance = 0;
        let totalDuration = 0;

        route.legs.forEach(leg => {
            totalDistance += leg.distance.value; // in meters
            totalDuration += leg.duration.value; // in seconds
        });

        return {
            distance: totalDistance, // in meters
            duration: totalDuration, // in seconds
            route: route
        };

    } catch (err) {
        console.error('Google Maps API request failed:', err);
        throw new Error('Route calculation failed due to a network or API error.');
    }
};

export { calculateRoute, getHubCoords };
