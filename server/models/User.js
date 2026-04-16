import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    usernameLower: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ['CUSTOMER', 'ADMIN', 'DRIVER'],
      default: 'CUSTOMER'
    },
    creditBalance: { type: Number, default: 0 },
    authorizedCreditBalance: { type: Number, default: 0 },
    loyaltyPoints: { type: Number, default: 0 },
    membershipTier: {
      type: String,
      enum: ['COMMON', 'BRONZE', 'SILVER', 'GOLD'],
      default: 'COMMON'
    },
    ordersCompleted: { type: Number, default: 0 },
    phoneVerified: { type: Boolean, default: false },
    photoIdVerified: { type: Boolean, default: false },
    resetTokenHash: { type: String },
    resetTokenExpiresAt: { type: Date },
    creditTransactionId: { type: String }
  },
  { timestamps: true }
);

userSchema.index({ usernameLower: 1 }, { unique: true });

const normalizeUsername = (value) => String(value || '').trim().toLowerCase();

userSchema.pre('validate', function (next) {
  if (this.isModified('username') || !this.usernameLower) {
    this.usernameLower = normalizeUsername(this.username);
  }

  next();
});

// Hash the password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  const hashedPassword = await bcrypt.hash(this.password, 10);
  this.password = hashedPassword;
  next();
});

// Compare the provided password with the hashed one
userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

const User = mongoose.model('User', userSchema);

export default User;
