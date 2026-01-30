import type { MutableRefObject } from 'react';

interface VideoReadyStateOptions {
  videoEl: HTMLVideoElement;
  onReady: () => void;
  metadataHandlerRef: MutableRefObject<(() => void) | null>;
  dataHandlerRef: MutableRefObject<(() => void) | null>;
}

export const updateVideoReadyState = ({
  videoEl,
  onReady,
  metadataHandlerRef,
  dataHandlerRef
}: VideoReadyStateOptions) => {
  const clearHandlers = () => {
    if (metadataHandlerRef.current) {
      videoEl.removeEventListener('loadedmetadata', metadataHandlerRef.current);
      metadataHandlerRef.current = null;
    }
    if (dataHandlerRef.current) {
      videoEl.removeEventListener('loadeddata', dataHandlerRef.current);
      dataHandlerRef.current = null;
    }
  };

  const markReady = () => {
    clearHandlers();
    onReady();
  };

  if (videoEl.readyState >= HTMLMediaElement.HAVE_METADATA) {
    markReady();
  } else {
    metadataHandlerRef.current = markReady;
    videoEl.addEventListener('loadedmetadata', markReady, { once: true });
  }
  if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    markReady();
  } else {
    dataHandlerRef.current = markReady;
    videoEl.addEventListener('loadeddata', markReady, { once: true });
  }
};
