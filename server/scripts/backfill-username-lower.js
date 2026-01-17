import dotenv from 'dotenv';

import connectDB from '../db/connect.js';
import User from '../models/User.js';

dotenv.config();

const normalizeUsername = (value) => String(value || '').trim().toLowerCase();

const backfillUsernameLower = async () => {
  await connectDB();

  const users = await User.find({}, { username: 1, usernameLower: 1 }).lean();
  const collisions = new Map();
  const invalidUsers = [];

  for (const user of users) {
    const normalized = normalizeUsername(user.username);
    if (!normalized) {
      invalidUsers.push({ id: user._id.toString(), username: user.username });
      continue;
    }

    if (!collisions.has(normalized)) {
      collisions.set(normalized, []);
    }

    collisions.get(normalized).push({
      id: user._id.toString(),
      username: user.username
    });
  }

  const collisionList = Array.from(collisions.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([normalized, entries]) => ({ normalized, entries }));

  if (invalidUsers.length || collisionList.length) {
    if (invalidUsers.length) {
      console.error('Users with empty/invalid normalized usernames:');
      invalidUsers.forEach((user) => {
        console.error(`- ${user.id}: "${user.username}"`);
      });
    }

    if (collisionList.length) {
      console.error('Username normalization collisions detected:');
      collisionList.forEach((collision) => {
        console.error(`- ${collision.normalized}`);
        collision.entries.forEach((entry) => {
          console.error(`  - ${entry.id}: "${entry.username}"`);
        });
      });
    }

    console.error('Resolve collisions before backfilling usernameLower.');
    process.exit(1);
  }

  const updates = users
    .map((user) => {
      const normalized = normalizeUsername(user.username);
      if (user.usernameLower === normalized) {
        return null;
      }

      return {
        updateOne: {
          filter: { _id: user._id },
          update: { $set: { usernameLower: normalized } }
        }
      };
    })
    .filter(Boolean);

  if (updates.length) {
    const result = await User.bulkWrite(updates);
    console.log(`Backfilled usernameLower for ${result.modifiedCount} users.`);
  } else {
    console.log('No usernameLower updates needed.');
  }

  process.exit(0);
};

backfillUsernameLower().catch((err) => {
  console.error('Failed to backfill usernameLower:', err);
  process.exit(1);
});
