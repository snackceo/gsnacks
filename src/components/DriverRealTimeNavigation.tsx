import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Navigation2, AlertCircle, Loader2, X } from 'lucide-react';

interface DriverRealTimeNavigationProps {
  address: string;
  onClose: () => void;
}

const DriverRealTimeNavigation: React.FC<DriverRealTimeNavigationProps> = ({ address, onClose }) => {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [distance, setDistance] = useState<number | null>(null);
  const [eta, setEta] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      position => {
        setLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLoading(false);
      },
      () => {
        setError('Unable to get your location. Please enable location services.');
        setLoading(false);
      }
    );
  }, []);

  useEffect(() => {
    if (!location || !mapRef.current) return;
    const g = (window as any).google;
    if (!g?.maps) return;

    const map = new g.maps.Map(mapRef.current, {
      zoom: 15,
      center: location,
      styles: [
        { elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a1a' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#ffffff' }] }
      ]
    });

    new g.maps.Marker({
      position: location,
      map,
      title: 'Your Location',
      icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'
    });

    const geocoder = new g.maps.Geocoder();
    geocoder.geocode({ address }, (results: any, status: string) => {
      if (status === 'OK' && results && results[0]) {
        const destination = results[0].geometry.location;

        new g.maps.Marker({
          position: destination,
          map,
          title: 'Delivery Address',
          icon: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png'
        });

        const service = new g.maps.DistanceMatrixService();
        service.getDistanceMatrix(
          {
            origins: [location],
            destinations: [destination],
            travelMode: g.maps.TravelMode.DRIVING
          },
          (response: any) => {
            const element = response?.rows?.[0]?.elements?.[0];
            if (element?.status === 'OK') {
              setDistance(element.distance.value / 1000); // km
              setEta(element.duration.text);
            }
          }
        );

        const bounds = new g.maps.LatLngBounds();
        bounds.extend(location);
        bounds.extend(destination);
        map.fitBounds(bounds);
      }
    });
  }, [location, address]);

  useEffect(() => {
    const interval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(pos => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 bg-ninpo-black text-white z-50 flex flex-col">
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

      {error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
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
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-ninpo-lime" />
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <div ref={mapRef} className="flex-1" />
          <div className="bg-white/5 border-t border-white/10 p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 rounded-xl p-4">
                <p className="text-xs text-white/60 uppercase font-bold mb-1">Distance</p>
                <p className="text-2xl font-black text-ninpo-lime">{distance ? `${distance.toFixed(1)} km` : '--'}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-4">
                <p className="text-xs text-white/60 uppercase font-bold mb-1">ETA</p>
                <p className="text-2xl font-black text-white">{eta || '--'}</p>
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
      )}
    </div>
  );
};

export default DriverRealTimeNavigation;
