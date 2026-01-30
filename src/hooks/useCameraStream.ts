import { useCallback, useEffect, useRef, useState } from 'react';
import { updateVideoReadyState } from '../utils/videoReady';

interface UseCameraStreamOptions {
  autoStart?: boolean;
  videoConstraints?: MediaTrackConstraints;
}

const defaultVideoConstraints: MediaTrackConstraints = {
  facingMode: 'environment',
  width: { ideal: 1280 },
  height: { ideal: 720 }
};

const useCameraStream = ({
  autoStart = true,
  videoConstraints = defaultVideoConstraints
}: UseCameraStreamOptions = {}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoReadyHandlerRef = useRef<(() => void) | null>(null);
  const videoDataHandlerRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);
  const [streamActive, setStreamActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      if (videoReadyHandlerRef.current) {
        videoRef.current.removeEventListener('loadedmetadata', videoReadyHandlerRef.current);
        videoReadyHandlerRef.current = null;
      }
      if (videoDataHandlerRef.current) {
        videoRef.current.removeEventListener('loadeddata', videoDataHandlerRef.current);
        videoDataHandlerRef.current = null;
      }
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
    startedRef.current = false;
  }, []);

  const startCamera = useCallback(async (constraints?: MediaTrackConstraints) => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: constraints ?? videoConstraints,
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        const videoEl = videoRef.current;
        videoEl.srcObject = stream;
        setStreamActive(false);
        try {
          await videoEl.play();
        } catch {
          // ignore autoplay failures
        }
        updateVideoReadyState({
          videoEl,
          onReady: () => setStreamActive(true),
          metadataHandlerRef: videoReadyHandlerRef,
          dataHandlerRef: videoDataHandlerRef
        });
      }
    } catch (err) {
      startedRef.current = false;
      setError('Camera access denied. Please enable camera permissions.');
    }
  }, [videoConstraints]);

  useEffect(() => {
    if (!autoStart) {
      return;
    }
    startCamera();
    return () => stopCamera();
  }, [autoStart, startCamera, stopCamera]);

  const clearError = useCallback(() => setError(null), []);

  return {
    videoRef,
    streamRef,
    streamActive,
    error,
    startCamera,
    stopCamera,
    clearError
  };
};

export default useCameraStream;
