import dotenv from 'dotenv';

import connectDB from '../db/connect.js';
import User from '../models/User.js';

dotenv.config();

const [,, usernameArg, passwordArg] = process.argv;

const username = (usernameArg || process.env.OWNER_USERNAME || '').trim();
const password = (passwordArg || process.env.OWNER_PASSWORD || '').trim();

if (!username || !password) {
  console.error('Usage: node scripts/create-owner.js <username> <password>');
  console.error('Or set OWNER_USERNAME and OWNER_PASSWORD in the environment.');
  process.exit(1);
}

const ownerEnv = (process.env.OWNER_USERNAMES || process.env.OWNER_USERNAME || '')
  .split(',')
  .map(entry => entry.trim().toLowerCase())
  .filter(Boolean);

const ensureOwnerUser = async () => {
  await connectDB();

  const existing = await User.findOne({ username });
  if (existing) {
    existing.password = password;
    existing.role = 'OWNER';
    if (!existing.membershipTier) {
      existing.membershipTier = 'PLATINUM';
    }
    await existing.save();
    console.log(`Updated owner user "${username}".`);
  } else {
    await User.create({
      username,
      password,
      role: 'OWNER',
      loyaltyPoints: 100,
      creditBalance: 0,
      membershipTier: 'PLATINUM'
    });
    console.log(`Created owner user "${username}".`);
  }

  if (!ownerEnv.includes(username.toLowerCase())) {
    console.warn(
      'OWNER_USERNAMES does not include this username. ' +
        'Set OWNER_USERNAMES (comma-separated) so logins keep OWNER access.'
    );
  }
};

ensureOwnerUser()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Failed to create owner user:', err);
    process.exit(1);
  });
