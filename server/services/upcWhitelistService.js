import UpcItem from '../models/UpcItem.js';

/**
 * Retrieves the full list of eligible UPCs from the database.
 * @returns {Promise<string[]>} A promise that resolves to an array of UPC strings.
 */
export const getUpcWhitelist = async () => {
  const eligibleItems = await UpcItem.find({ isEligible: true }).select('upc').lean();
  return eligibleItems.map(item => item.upc);
};