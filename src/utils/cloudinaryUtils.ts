/**
 * Cloudinary upload utilities for receipts and images
 */

interface CloudinaryUploadOptions {
  folder?: string;
  context?: Record<string, string>;
  publicId?: string;
  tags?: string[];
}


export function isCloudinaryConfigured(): boolean {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;
  return Boolean(cloudName && uploadPreset);
}

interface CloudinaryUploadResult {
  url: string;
  secureUrl: string;
  publicId: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Upload a photo to Cloudinary
 * @param dataUrl - Data URL of the image (e.g., from canvas.toDataURL())
 * @param options - Upload options (folder, context, etc.)
 * @returns Promise with upload result including secure_url
 */
export async function uploadToCloudinary(
  dataUrl: string,
  options: CloudinaryUploadOptions = {}
): Promise<CloudinaryUploadResult | null> {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;

  if (!cloudName || !uploadPreset) {
    console.warn('Cloudinary not configured. Upload will not proceed.');
    return null;
  }

  try {
    // Convert data URL to blob
    const imageBlob = await fetch(dataUrl).then(res => res.blob());
    const formData = new FormData();

    formData.append('file', imageBlob);
    formData.append('upload_preset', uploadPreset);

    if (options.folder) {
      formData.append('folder', options.folder);
    }

    if (options.publicId) {
      formData.append('public_id', options.publicId);
    }

    if (options.tags && options.tags.length > 0) {
      formData.append('tags', options.tags.join(','));
    }

    // Add context as JSON string
    if (options.context && Object.keys(options.context).length > 0) {
      formData.append(
        'context',
        Object.entries(options.context)
          .map(([k, v]) => `${k}=${v}`)
          .join('|')
      );
    }

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      {
        method: 'POST',
        body: formData
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData?.error?.message || `Upload failed with status ${response.status}`);
    }

    const data = await response.json();

    return {
      url: data.url,
      secureUrl: data.secure_url,
      publicId: data.public_id,
      format: data.format,
      width: data.width,
      height: data.height,
      bytes: data.bytes
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw error;
  }
}

/**
 * Upload a receipt photo to Cloudinary
 * @param dataUrl - Data URL of the receipt image
 * @param storeId - ID of the store for context
 * @param storeName - Name of the store for context
 * @returns Promise with upload result
 */
export async function uploadReceiptPhoto(
  dataUrl: string,
  storeId?: string,
  storeName?: string
): Promise<CloudinaryUploadResult | null> {
  const context: Record<string, string> = {};
  if (storeId) context.storeId = storeId;
  if (storeName) context.storeName = storeName;

  return uploadToCloudinary(dataUrl, {
    folder: 'receipts',
    tags: ['receipt', 'inventory'],
    context: Object.keys(context).length ? context : undefined
  });
}
