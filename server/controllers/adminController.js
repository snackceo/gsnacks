const User = require('../models/User.js');
const asyncHandler = require('../utils/asyncHandler.js');
const ErrorResponse = require('../utils/errorResponse');
const { recordAuditLog } = require('../services/auditLogService.js');

// @desc    Get all users
// @route   GET /api/v1/admin/users
// @access  Private (Admin/Owner)
exports.getUsers = asyncHandler(async (req, res, next) => {
  const users = await User.find({});
  res.status(200).json({ success: true, count: users.length, data: users });
});

// @desc    Get single user
// @route   GET /api/v1/admin/users/:id
// @access  Private (Admin/Owner)
exports.getUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }
  res.status(200).json({ success: true, data: user });
});

// @desc    Update user
// @route   PUT /api/v1/admin/users/:id
// @access  Private (Admin/Owner)
exports.updateUser = asyncHandler(async (req, res, next) => {
  // Whitelist fields that can be updated to prevent mass assignment vulnerabilities
  const { name, email, role, isVerified } = req.body;
  const updateFields = { name, email, role, isVerified };

  // Filter out undefined values so we don't accidentally nullify fields
  Object.keys(updateFields).forEach(key => updateFields[key] === undefined && delete updateFields[key]);

  const user = await User.findByIdAndUpdate(req.params.id, updateFields, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  await recordAuditLog({
    actorId: req.user._id,
    action: 'USER_UPDATED',
    targetType: 'User',
    targetId: user._id,
    details: { changes: updateFields },
  });

  res.status(200).json({ success: true, data: user });
});

// @desc    Delete user
// @route   DELETE /api/v1/admin/users/:id
// @access  Private (Owner)
exports.deleteUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  await user.remove();

  await recordAuditLog({
    actorId: req.user._id,
    action: 'USER_DELETED',
    targetType: 'User',
    targetId: req.params.id,
  });

  res.status(200).json({ success: true, data: {} });
});