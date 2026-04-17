import { resolveDistanceMiles } from '../utils/distance.js';
import asyncHandler from '../utils/asyncHandler.js';

export const calculateDistance = asyncHandler(async (req, res, next) => {
  const distanceMiles = await resolveDistanceMiles(req.body?.address);
  const roundedMiles = Math.floor(distanceMiles * 10) / 10;
  return res.json({
    distanceMiles,
    roundedMiles
  });
});