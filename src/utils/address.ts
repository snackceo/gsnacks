import { AddressObject } from '../types';

const buildParts = (address?: AddressObject | string) => {
  if (!address) return [] as string[];
  if (typeof address === 'string') {
    const trimmed = address.trim();
    return trimmed ? [trimmed] : [];
  }
  return [address.street, address.city, address.state, address.zip, address.country]
    .map(part => (part ?? '').toString().trim())
    .filter(Boolean);
};

export const formatStoreAddress = (
  address?: AddressObject | string,
  fallback = ''
): string => {
  const parts = buildParts(address);
  return parts.length ? parts.join(', ') : fallback;
};

export const formatStoreCityStateZip = (
  address?: AddressObject | string,
  fallback = ''
): string => {
  if (!address) return fallback;
  if (typeof address === 'string') {
    const trimmed = address.trim();
    return trimmed || fallback;
  }
  const parts = [address.city, address.state, address.zip]
    .map(part => (part ?? '').toString().trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : fallback;
};
