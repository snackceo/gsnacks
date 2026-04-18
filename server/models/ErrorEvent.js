const mongoose = require('mongoose');

const ErrorEventSchema = new mongoose.Schema({
  message: {
    type: String,
    required: true,
  },
  level: {
    type: String,
    enum: ['error', 'warning', 'info'],
    default: 'error',
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  url: String,
  stackTrace: String,
  userId: String,
  context: mongoose.Schema.Types.Mixed,
});

module.exports = mongoose.model('ErrorEvent', ErrorEventSchema);
