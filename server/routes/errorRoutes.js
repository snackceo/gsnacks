const express = require('express');
const { logError, getRecentErrors } = require('../controllers/errorController');
const router = express.Router();

// The OpenAPI spec defines the security for getRecentErrors,
// and the express-openapi-validator will enforce it.
// We'll also need to make sure the auth middleware is configured correctly.
// A file `server/middleware/auth.js` exists, which is a good sign.
router.route('/').post(logError).get(getRecentErrors);

module.exports = router;
