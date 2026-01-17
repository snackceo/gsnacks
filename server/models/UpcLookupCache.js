import mongoose from 'mongoose';

const upcLookupCacheSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    payload: { type: Object, required: true },
    fetchedAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

upcLookupCacheSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

export default mongoose.model('UpcLookupCache', upcLookupCacheSchema);
