const express = require('express');
const {
  getUsers,
  getUser,
  updateUser,
  deleteUser,
} = require('../controllers/adminController.js');

const router = express.Router();

const { protect, authorize } = require('../middleware/auth.js');

// All routes in this file are protected and for admins/owners
router.use(protect);
router.use(authorize('admin', 'owner'));

router.route('/users').get(getUsers);
router.route('/users/:id').get(getUser).put(updateUser).delete(authorize('owner'), deleteUser); // Only owner can delete

module.exports = router;