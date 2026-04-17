import mongoose from 'mongoose';

const cartSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // One cart per user
  },
  items: [{
    productId: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
}, {
  timestamps: true
});

// Index for fast user lookups
cartSchema.index({ userId: 1 });

// Clean up old items (optional - remove items older than 30 days)
cartSchema.methods.cleanOldItems = function() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  this.items = this.items.filter(item => item.addedAt > thirtyDaysAgo);
};

const Cart = mongoose.model('Cart', cartSchema);

export default Cart;
