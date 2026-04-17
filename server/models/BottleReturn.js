import mongoose from 'mongoose';

const BottleReturnSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
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
      index: true
    },
    creditAmount: {
      type: Number,
      default: 0,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    verification: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ReturnVerification',
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('BottleReturn', BottleReturnSchema);