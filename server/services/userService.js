import User from '../models/User.js';

export const findUserByUsername = async (username) => {
  return await User.findOne({ username });
};

export const findUserByUsernameLower = async (usernameLower) => {
  return await User.findOne({ usernameLower });
};

export const createUser = async (userData) => {
  const user = new User(userData);
  await user.save();
  return user;
};

export const findUserById = async (id) => {
  return await User.findById(id).lean();
};

export const findUserByResetToken = async (tokenHash) => {
    return await User.findOne({
        resetTokenHash: tokenHash,
        resetTokenExpiresAt: { $gt: new Date() }
    });
};
