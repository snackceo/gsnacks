import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'CUSTOMER' },
    creditBalance: { type: Number, default: 0 },
    loyaltyPoints: { type: Number, default: 0 },
    membershipTier: { type: String, default: 'BRONZE' },
    resetTokenHash: { type: String },
    resetTokenExpiresAt: { type: Date }
  },
  { timestamps: true }
);

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
