const mongoose = require('mongoose');

const BottleReturnSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    numberOfBottles: {
      type: Number,
      required: [true, 'Please specify the number of bottles'],
    },
    imageProofUrl: {
      type: String,
      required: [true, 'Please provide an image proof URL'],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    creditAmount: {
      type: Number,
      default: 0,
    },
    reviewedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('BottleReturn', BottleReturnSchema);