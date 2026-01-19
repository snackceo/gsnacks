import AppSettings from '../models/AppSettings.js';
import { isOwnerUsername } from './helpers.js';

const SETTINGS_KEY = 'default';

/**
 * Maintenance mode middleware.
 * Blocks customer-facing endpoints when maintenance mode is enabled.
 * Owner/admin users can still access all endpoints.
 */
export const maintenanceModeGuard = async (req, res, next) => {
  try {
    // Check if maintenance mode is enabled
    const settings = await AppSettings.findOne({ key: SETTINGS_KEY });
    const maintenanceMode = settings?.maintenanceMode ?? false;

    if (!maintenanceMode) {
      // Maintenance mode is off, allow all requests
      return next();
    }

    // Maintenance mode is ON - check if user is owner
    const user = req.user;
    if (user && isOwnerUsername(user.username)) {
      // Owner can access during maintenance
      return next();
    }

    // Block customer requests during maintenance
    return res.status(503).json({
      error: 'System under maintenance. Please check back later.',
      maintenanceMode: true
    });
  } catch (err) {
    // On error, fail open (allow request) to prevent total lockout
    console.error('Maintenance mode check failed:', err);
    return next();
  }
};

/**
 * Cached maintenance mode check for performance.
 * Caches the maintenance mode status for 10 seconds.
 */
let maintenanceModeCache = null;
let maintenanceModeCacheTime = 0;
const CACHE_TTL = 10000; // 10 seconds

export const maintenanceModeGuardCached = async (req, res, next) => {
  try {
    const now = Date.now();
    
    // Refresh cache if expired
    if (!maintenanceModeCache || (now - maintenanceModeCacheTime) > CACHE_TTL) {
      const settings = await AppSettings.findOne({ key: SETTINGS_KEY });
      maintenanceModeCache = settings?.maintenanceMode ?? false;
      maintenanceModeCacheTime = now;
    }

    if (!maintenanceModeCache) {
      // Maintenance mode is off
      return next();
    }

    // Maintenance mode is ON - check if user is owner
    const user = req.user;
    if (user && isOwnerUsername(user.username)) {
      // Owner can access during maintenance
      return next();
    }

    // Block customer requests during maintenance
    return res.status(503).json({
      error: 'System under maintenance. Please check back later.',
      maintenanceMode: true
    });
  } catch (err) {
    // On error, fail open to prevent lockout
    console.error('Maintenance mode check failed:', err);
    return next();
  }
};

/**
 * Clear the maintenance mode cache.
 * Call this when settings are updated.
 */
export const clearMaintenanceModeCache = () => {
  maintenanceModeCache = null;
  maintenanceModeCacheTime = 0;
};
