const BottleReturn = require('../models/BottleReturn.js');
const User = require('../models/User.js');
const asyncHandler = require('../utils/asyncHandler.js');
const ErrorResponse = require('../utils/errorResponse');
const { recordAuditLog } = require('../services/auditLogService.js');

const DAILY_SUBMISSION_LIMIT = 1; // Fraud prevention
const CREDIT_PER_BOTTLE = 0.1; // Example: $0.10 credit per bottle

// @desc    Create a bottle return request
// @route   POST /api/v1/returns
// @access  Private (Customer)
exports.createReturnRequest = asyncHandler(async (req, res, next) => {
  const { numberOfBottles, imageProofUrl } = req.body;

  // --- Fraud Prevention: Limit submissions per day ---
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const submissionsToday = await BottleReturn.countDocuments({
    user: req.user._id,
    createdAt: { $gte: today, $lt: tomorrow },
  });

  if (submissionsToday >= DAILY_SUBMISSION_LIMIT) {
    return next(new ErrorResponse(`You have reached the daily limit of ${DAILY_SUBMISSION_LIMIT} return requests.`, 429));
  }

  const returnRequest = await BottleReturn.create({
    user: req.user._id,
    numberOfBottles,
    imageProofUrl,
  });

  res.status(201).json({ success: true, data: returnRequest });
});

// @desc    Get all return requests
// @route   GET /api/v1/returns
// @access  Private (Admin/Owner)
exports.getReturnRequests = asyncHandler(async (req, res, next) => {
  const requests = await BottleReturn.find().populate('user', 'name email');
  res.status(200).json({ success: true, count: requests.length, data: requests });
});

// @desc    Get my return requests
// @route   GET /api/v1/returns/myreturns
// @access  Private (Customer)
exports.getMyReturnRequests = asyncHandler(async (req, res, next) => {
  const requests = await BottleReturn.find({ user: req.user._id });
  res.status(200).json({ success: true, count: requests.length, data: requests });
});

// @desc    Review a bottle return request (Approve/Reject)
// @route   PUT /api/v1/returns/:id/review
// @access  Private (Admin/Owner)
exports.reviewReturnRequest = asyncHandler(async (req, res, next) => {
  const { status } = req.body; // 'approved' or 'rejected'

  if (!['approved', 'rejected'].includes(status)) {
    return next(new ErrorResponse('Invalid status. Must be "approved" or "rejected".', 400));
  }

  const request = await BottleReturn.findById(req.params.id);

  if (!request) {
    return next(new ErrorResponse('Return request not found', 404));
  }

  if (request.status !== 'pending') {
    return next(new ErrorResponse(`This request has already been reviewed and is ${request.status}.`, 400));
  }

  request.status = status;
  request.reviewedBy = req.user._id;

  // --- CRITICAL: Issue credit ONLY on approval ---
  if (status === 'approved') {
    const creditAmount = request.numberOfBottles * CREDIT_PER_BOTTLE;
    request.creditAmount = creditAmount;

    // Find the user and add credit to their balance
    // This should be a transactional operation in a real production system
    await User.findByIdAndUpdate(request.user, {
      $inc: { creditBalance: creditAmount },
    });
  }

  await request.save();

  await recordAuditLog({
    actorId: req.user._id,
    action: 'BOTTLE_RETURN_REVIEWED',
    targetType: 'BottleReturn',
    targetId: request._id,
    details: { newStatus: status, creditIssued: request.creditAmount },
  });

  res.status(200).json({ success: true, data: request });
});