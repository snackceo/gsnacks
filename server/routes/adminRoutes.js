import express from 'express';
import {
  getUsers,
  getUser,
  updateUser,
  deleteUser,
} from '../controllers/adminController.js';

const router = express.Router();

import { protect, authorize } from '../middleware/auth.js';

// All routes in this file are protected and for admins/owners
router.use(protect);
router.use(authorize('admin', 'owner'));

router.route('/users').get(getUsers);
router.route('/users/:id').get(getUser).put(updateUser).delete(authorize('owner'), deleteUser); // Only owner can delete
export default router;