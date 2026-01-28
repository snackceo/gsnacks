import { ClassifiedReceiptItem } from '../types';

/**
 * Receipt utility functions for receipt workflows
 * for reusability and reduced component complexity.
 */

export const isMongoId = (value: string): boolean => /^[a-f0-9]{24}$/i.test(value);

export const formatReceiptSource = (source?: string): string => 
  source ? source.replace(/_/g, ' ') : 'unknown';

export const formatReceiptRole = (role?: string): string => {
  if (!role) return 'unknown';
  return `${role.slice(0, 1)}${role.slice(1).toLowerCase()}`;
};

export const formatReceiptUserId = (userId?: string): string => {
  if (!userId) return 'unknown';
  if (userId.length <= 10) return userId;
  return `${userId.slice(0, 6)}…${userId.slice(-4)}`;
};

export const getSafeCaptureStatus = (status?: string): string => {
  if (!status) return 'unknown';
  return status.replace(/_/g, ' ');
};

export const getReceiptItemKey = (item: ClassifiedReceiptItem): string => {
  if (item.captureId && typeof item.lineIndex === 'number') {
    return `${item.captureId}:${item.lineIndex}`;
  }
  return JSON.stringify({
    receiptName: item.receiptName,
    unitPrice: item.unitPrice,
    totalPrice: item.totalPrice
  });
};
