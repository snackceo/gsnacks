import mongoose from 'mongoose';

const CounterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    value: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export default mongoose.model('Counter', CounterSchema);
