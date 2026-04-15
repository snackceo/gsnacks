export const shouldAutoCreateStore = (store) => {
  // TODO: Implement logic to determine if a store should be auto-created.
  return true;
};

export const normalizePhone = (phone) => {
  if (!phone) return null;
  return phone.replace(/\D/g, '');
};

export const normalizeStoreNumber = (storeNumber) => {
  if (!storeNumber) return null;
  return storeNumber.toString().trim();
};

export const matchStoreCandidate = async (store) => {
  // TODO: Implement logic to match a store candidate.
  return { confidence: 0, match: null };
};
