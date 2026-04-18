import { useState, useCallback } from 'react';
import { Order, OrderStatus, ReturnUpcCount, User } from '../types';
import { useNinpoCore } from './useNinpoCore';
import { apiFetch } from '../utils/apiFetch';

interface UseDeliveryWorkflowProps {
  activeOrder: Order | null;
  currentUser: User | null;
  updateOrder: (id: string, status: OrderStatus, metadata?: any) => void;
  verifiedReturnUpcs: ReturnUpcCount[];
}

export const useDeliveryWorkflow = ({ activeOrder, currentUser, updateOrder, verifiedReturnUpcs }: UseDeliveryWorkflowProps) => {
  const { addToast } = useNinpoCore();
  const [isVerifying, setIsVerifying] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [returnCapturedPhoto, setReturnCapturedPhoto] = useState<string | null>(null);
  const [contaminationConfirmed, setContaminationConfirmed] = useState(false);
  const [driverNotice, setDriverNotice] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);

  const resetPhotoState = () => setCapturedPhoto(null);
  const resetReturnPhotoState = () => {
    setReturnCapturedPhoto(null);
    setContaminationConfirmed(false);
  };

  const uploadPhoto = async (photo: string, type: 'proof' | 'return', orderId: string) => {
    if (!photo) return null;
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;

    if (cloudName && uploadPreset) {
      const imageBlob = await fetch(photo).then(res => res.blob());
      const formData = new FormData();
      formData.append('file', imageBlob, `${type}-${orderId}.jpg`);
      formData.append('upload_preset', uploadPreset);
      formData.append('folder', type === 'proof' ? 'delivery-proofs' : 'return-photos');
      formData.append('context', `orderId=${orderId}`);
      const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: formData });
      const uploadData: { secure_url?: string; url?: string; error?: { message?: string } } = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) throw new Error(uploadData?.error?.message || `${type} photo upload failed.`);
      return uploadData?.secure_url || uploadData?.url || null;
    }

    const endpoint = type === 'proof' ? '/api/v1/uploads/proof' : '/api/v1/uploads/return-photo';
    const { url } = await apiFetch<{ url: string }>(endpoint, { method: 'POST', body: JSON.stringify({ orderId, imageData: photo }) });
    return url;
  };

  const completeDelivery = useCallback(async () => {
    if (!activeOrder) return;

    setIsVerifying(true);
    setDriverNotice(null);

    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const proofUrl = await uploadPhoto(capturedPhoto!, 'proof', activeOrder.id);
          const returnPhotoUrl = await uploadPhoto(returnCapturedPhoto!, 'return', activeOrder.id);

          const { data: updatedOrder } = await apiFetch<{ data: Order }>(`/api/v1/orders/${activeOrder.id}/complete`, {
            method: 'POST',
            body: JSON.stringify({
              gpsCoords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
              verificationPhoto: proofUrl,
              returnPhoto: returnPhotoUrl,
              contaminationConfirmed,
              verifiedReturnUpcs,
            }),
          });

          updateOrder(activeOrder.id, OrderStatus.DELIVERED, updatedOrder);
          setDriverNotice({ tone: 'success', message: 'Delivery completed and proof uploaded.' });
          return true; // Indicate success
        } catch (e: any) {
          setDriverNotice({ tone: 'error', message: e?.message || 'Delivery completion failed.' });
          return false; // Indicate failure
        } finally {
          setIsVerifying(false);
        }
      },
      () => {
        setDriverNotice({ tone: 'error', message: 'GPS is required to complete delivery.' });
        setIsVerifying(false);
      },
      { enableHighAccuracy: true }
    );
  }, [activeOrder, capturedPhoto, returnCapturedPhoto, contaminationConfirmed, verifiedReturnUpcs, updateOrder, addToast]);

  return {
    isVerifying,
    capturedPhoto,
    setCapturedPhoto,
    returnCapturedPhoto,
    setReturnCapturedPhoto,
    contaminationConfirmed,
    setContaminationConfirmed,
    driverNotice,
    setDriverNotice,
    completeDelivery,
    resetPhotoState,
    resetReturnPhotoState,
  };
};