// server/utils/auth.js
// Re-exports auth middleware and helpers from helpers.js for cleaner imports
// This module bridges the import path used by cart.js and other routes

import {
  authRequired,
  isOwnerUsername,
  isDriverUsername,
  ownerRequired,
  setAuthCookie,
  clearAuthCookie
} from './helpers.js';

export { authRequired, isOwnerUsername, isDriverUsername, ownerRequired, setAuthCookie, clearAuthCookie };

// Alias for convenience
export const protect = authRequired;
