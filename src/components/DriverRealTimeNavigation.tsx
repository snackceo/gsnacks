import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigation2, AlertCircle, Loader2, X } from 'lucide-react';

interface DriverRealTimeNavigationProps {
  address: string;
  onClose: () => void;
}

type LatLng = { lat: number; lng: number };

function metersToMiles(m: number) {
  return m / 1609.344;
}

const DriverRealTimeNavigation: React.FC<DriverRealTimeNavigationProps> = ({ address, onClose }) => {
  const [location, setLocation] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(true);

  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [etaText, setEtaText] = useState<string | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);

  const googleRef = useMemo(() => {
    const w = window as any;
    return w?.google ?? null;
  }, []);

  // Track map objects so we can update markers cleanly
  const mapInstanceRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const destLatLngRef = useRef<any>(null);
  const watchIdRef = useRef<number | null>(null);

  // 1) Get driver location (watchPosition for realtime updates)
  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not available in this browser.');
      setLoadingLocation(false);
      return;
    }

    setLoadingLocation(true);

    // First quick fix: also call getCurrentPosition so UI doesn’t wait for watch callback
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLoadingLocation(false);
      },
      () => {
        setError('Unable to get your location. Please enable location services.');
        setLoadingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );

    // Then start watching for realtime updates
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        // Don’t spam errors if watch fails intermittently; only set if not already set
        setError((prev) => prev || 'Live location updates are unavailable. Check location permissions.');
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );

    watchIdRef.current = id;

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  // 2) Initialize map once we have location and google maps loaded
  useEffect(() => {
    if (!location) return;

    if (!googleRef || !googleRef.maps) {
      setError(
        'Google Maps is not loaded. Ensure Maps JavaScript API script is included and your API key is valid.'
      );
      return;
    }

    if (!mapRef.current) return;

    // Create map only once
    if (!mapInstanceRef.current) {
      const map = new googleRef.maps.Map(mapRef.current, {
        zoom: 15,
        center: location,
        disableDefaultUI: true,
        clickableIcons: false,
        styles: [
          { elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
          { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a1a' }] },
          { elementType: 'labels.text.fill', stylers: [{ color: '#ffffff' }] }
        ]
      });

      mapInstanceRef.current = map;

      driverMarkerRef.current = new googleRef.maps.Marker({
        position: location,
        map,
        title: 'Your Location',
        icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'
      });
    } else {
      // Map exists; just update center/marker position
      driverMarkerRef.current?.setPosition(location);
    }
  }, [location, googleRef]);

  // 3) Geocode destination when address changes
  useEffect(() => {
    if (!location) return;
    if (!googleRef || !googleRef.maps) return;
    if (!mapInstanceRef.current) return;

    const addr = String(address || '').trim();
    if (!addr) {
      setError('No delivery address provided.');
      return;
    }

    const geocoder = new googleRef.maps.Geocoder();
    geocoder.geocode({ address: addr }, (results: any, status: string) => {
      if (status !== 'OK' || !results?.[0]?.geometry?.location) {
        setError('Unable to find this address on the map.');
        return;
      }

      const destination = results[0].geometry.location;
      destLatLngRef.current = destination;

      // Destination marker
      if (!destMarkerRef.current) {
        destMarkerRef.current = new googleRef.maps.Marker({
          position: destination,
          map: mapInstanceRef.current,
          title: 'Delivery Address',
          icon: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png'
        });
      } else {
        destMarkerRef.current.setPosition(destination);
      }

      // Fit bounds
      const bounds = new googleRef.maps.LatLngBounds();
      bounds.extend(location);
      bounds.extend(destination);
      mapInstanceRef.current.fitBounds(bounds);

      // Trigger distance/ETA calc immediately
      tryCalculateDistanceMatrix(location, destination);
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, location, googleRef]);

  // 4) Whenever location updates AND we have a destination, refresh distance/ETA
  useEffect(() => {
    if (!location) return;
    if (!googleRef || !googleRef.maps) return;

    const destination = destLatLngRef.current;
    if (!destination) return;

    tryCalculateDistanceMatrix(location, destination);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const tryCalculateDistanceMatrix = (origin: LatLng, destination: any) => {
    if (!googleRef || !googleRef.maps) return;

    const service = new googleRef.maps.DistanceMatrixService();

    service.getDistanceMatrix(
      {
        origins: [origin],
        destinations: [destination],
        travelMode: googleRef.maps.TravelMode.DRIVING,
        unitSystem: googleRef.maps.UnitSystem.IMPERIAL
      },
      (response: any, status: string) => {
        if (status !== 'OK' || !response?.rows?.[0]?.elements?.[0]) {
          setEtaText(null);
          setDistanceMiles(null);
          return;
        }

        const element = response.rows[0].elements[0];
        if (element.status !== 'OK') {
          setEtaText(null);
          setDistanceMiles(null);
          return;
        }

        const meters = element.distance?.value;
        const durationText = element.duration?.text;

        if (typeof meters === 'number') {
          setDistanceMiles(metersToMiles(meters));
        } else {
          setDistanceMiles(null);
        }

        setEtaText(typeof durationText === 'string' ? durationText : null);
      }
    );
  };

  const showMap = !error && !loadingLocation;

  return (
    <div className="fixed inset-0 bg-ninpo-black text-white z-50 flex flex-col">
      {/* Header */}
      <div className="bg-white/5 border-b border-white/10 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Navigation2 className="w-5 h-5 text-ninpo-lime" />
          <div>
            <h1 className="font-black text-ninpo-lime">Real-Time Navigation</h1>
            <p className="text-sm text-white/60">{address}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-all">
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Body */}
      {error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-300">{error}</p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all"
            >
              Close
            </button>
          </div>
        </div>
      ) : loadingLocation ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-ninpo-lime" />
        </div>
      ) : showMap ? (
        <div className="flex-1 flex flex-col">
          <div ref={mapRef} className="flex-1" />

          {/* Distance and ETA */}
          <div className="bg-white/5 border-t border-white/10 p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 rounded-xl p-4">
                <p className="text-xs text-white/60 uppercase font-bold mb-1">Distance</p>
                <p className="text-2xl font-black text-ninpo-lime">
                  {distanceMiles != null ? `${distanceMiles.toFixed(1)} mi` : '--'}
                </p>
              </div>
              <div className="bg-white/5 rounded-xl p-4">
                <p className="text-xs text-white/60 uppercase font-bold mb-1">ETA</p>
                <p className="text-2xl font-black text-white">{etaText || '--'}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-black uppercase tracking-widest transition-all"
              >
                Close Map
              </button>
              <a
                href={`https://www.google.com/maps/search/${encodeURIComponent(address)}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-3 bg-ninpo-lime text-ninpo-black hover:bg-white rounded-xl font-black uppercase tracking-widest transition-all text-center"
              >
                Open in Maps
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-300">Unable to render map.</p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DriverRealTimeNavigation;
