const ErrorEvent = require('../models/ErrorEvent');

// @desc    Log a new error event
// @route   POST /api/errors
// @access  Public
const logError = async (req, res, next) => {
  try {
    const errorEvent = await ErrorEvent.create(req.body);
    res.status(201).json({ success: true, data: errorEvent });
  } catch (err) {
    console.error('Failed to log error to database:', err);
    // Using next() to pass to the openapi-validator error handler
    next(err);
  }
};

// @desc    Get recent error events
// @route   GET /api/errors
// @access  Private (for admins/devs)
const getRecentErrors = async (req, res, next) => {
  try {
    const errors = await ErrorEvent.find()
      .sort({ timestamp: -1 })
      .limit(50);
    res.status(200).json({ success: true, data: errors });
  } catch (err) {
    console.error(err);
    next(err);
  }
};

module.exports = {
  logError,
  getRecentErrors,
};
