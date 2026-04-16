import { isCloudinaryConfigured } from '../../config/cloudinary.js';
import { ALLOWED_IMAGE_HOSTS, ALLOWED_IMAGE_MIMES } from '../../config/constants.js';

export const hasCloudinary = isCloudinaryConfigured();

export const isAllowedReceiptMime = mime =>
  ALLOWED_IMAGE_MIMES.some(allowed => mime?.toLowerCase?.().includes(allowed));

export const isCloudinaryUrl = url => {
  try {
    const urlObj = new URL(url);
    return ALLOWED_IMAGE_HOSTS.some(host => urlObj.hostname?.includes(host));
  } catch (err) {
    return false;
  }
};

export const computeReceiptOcrSuccessSummary = captures => {
  const bucketTemplate = () => ({ total: 0, success: 0, successRate: null });
  const summary = {
    windowDays: 7,
    windowStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    geminiOnly: bucketTemplate(),
    visionOnly: bucketTemplate(),
    hybrid: bucketTemplate()
  };

  const isSuccess = status => ['parsed', 'review_complete', 'committed'].includes(String(status || '').toLowerCase());
  const toBucket = metrics => {
    const used = String(metrics?.providerUsed || '').toLowerCase();
    if (metrics?.fallbackReason) return 'hybrid';
    if (used === 'gemini') return 'geminiOnly';
    if (used === 'vision') return 'visionOnly';
    return null;
  };

  for (const capture of captures || []) {
    const bucketName = toBucket(capture?.parseMetrics || {});
    if (bucketName) {
      const bucket = summary[bucketName];
      bucket.total += 1;
      if (isSuccess(capture?.status)) bucket.success += 1;
      bucket.successRate = bucket.total > 0 ? Number(((bucket.success / bucket.total) * 100).toFixed(2)) : null;
    }
  }

  return summary;
};