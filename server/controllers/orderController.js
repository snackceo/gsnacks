const Order = require('../models/Order.js');
const Product = require('../models/Product.js');
const User = require('../models/User.js');
const asyncHandler = require('../utils/asyncHandler.js');
const ErrorResponse = require('../utils/errorResponse');
const { recordAuditLog } = require('../services/auditLogService.js');
const appEmitter = require('../events/eventEmitter');

// @desc    Create new order
// @route   POST /api/v1/orders
// @access  Private (Customer)
exports.addOrderItems = asyncHandler(async (req, res, next) => {
  const { orderItems, shippingAddress, totalPrice } = req.body;

  if (!orderItems || orderItems.length === 0) {
    return next(new ErrorResponse('No order items', 400));
  }

  // --- Stock Validation ---
  for (const item of orderItems) {
    const product = await Product.findById(item.product);
    if (!product) {
      return next(new ErrorResponse(`Product not found: ${item.name}`, 404));
    }
    if (product.stock < item.quantity) {
      return next(new ErrorResponse(`Not enough stock for ${product.name}. Only ${product.stock} left.`, 400));
    }
  }

  const order = new Order({
    orderItems,
    user: req.user._id,
    shippingAddress,
    totalPrice,
  });

  const createdOrder = await order.save();

  // --- Decrement Stock ---
  for (const item of createdOrder.orderItems) {
    await Product.findByIdAndUpdate(item.product, {
      $inc: { stock: -item.quantity },
    });
  }

  res.status(201).json({ success: true, data: createdOrder });
});

// @desc    Get order by ID
// @route   GET /api/v1/orders/:id
// @access  Private
exports.getOrderById = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id).populate('user', 'name email');

  if (!order) {
    return next(new ErrorResponse('Order not found', 404));
  }

  // Check if user is owner of order or admin/owner
  if (order.user._id.toString() !== req.user._id.toString() && !['admin', 'owner'].includes(req.user.role)) {
    return next(new ErrorResponse('Not authorized to view this order', 401));
  }

  res.status(200).json({ success: true, data: order });
});

// @desc    Get logged in user orders
// @route   GET /api/v1/orders/myorders
// @access  Private (Customer)
exports.getMyOrders = asyncHandler(async (req, res, next) => {
  const orders = await Order.find({ user: req.user._id });
  res.status(200).json({ success: true, count: orders.length, data: orders });
});

// @desc    Get all orders
// @route   GET /api/v1/orders
// @access  Private (Admin/Owner)
exports.getOrders = asyncHandler(async (req, res, next) => {
  const orders = await Order.find({}).populate('user', 'id name');
  res.status(200).json({ success: true, count: orders.length, data: orders });
});

// @desc    Update order status
// @route   PUT /api/v1/orders/:id/status
// @access  Private (Admin/Owner/Driver)
exports.updateOrderStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new ErrorResponse('Order not found', 404));
  }

  // --- Authorization Checks for Drivers ---
  // Driver can only update status to 'picked_up' or 'delivered' on their assigned order
  if (req.user.role === 'driver') {
    // Ensure a driver is assigned to this order
    if (!order.driver) {
      return next(new ErrorResponse('This order has not been assigned to a driver', 400));
    }
    // Ensure the order is assigned to THIS driver
    if (order.driver.toString() !== req.user._id.toString() || !['picked_up', 'delivered'].includes(status)) {
       return next(new ErrorResponse('Not authorized to update this order to that status', 401));
    }
  }
  // --- End Authorization Checks ---

  order.status = status;
  order.statusHistory.push({ status, timestamp: new Date() });

  await order.save();

  // --- Log administrative status changes ---
  if (['admin', 'owner', 'driver'].includes(req.user.role)) {
    await recordAuditLog({
      actorId: req.user._id,
      action: 'ORDER_STATUS_UPDATED',
      targetType: 'Order',
      targetId: order._id,
      details: { newStatus: status, previousStatus: order.status },
    });
  }

  // --- Emit Socket.IO Event ---
  const io = req.app.get('io');
  io.to(`order:${order._id}`).emit('status_update', { orderId: order._id, status: order.status });

  // --- Emit Notification Event ---
  appEmitter.emit('orderStatusUpdated', { order, status });

  res.status(200).json({ success: true, data: order });
});

// @desc    Assign a driver to an order
// @route   PUT /api/v1/orders/:id/assign
// @access  Private (Admin/Owner)
exports.assignDriverToOrder = asyncHandler(async (req, res, next) => {
  const { driverId } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) {
    return next(new ErrorResponse('Order not found', 404));
  }

  const driver = await User.findById(driverId);
  if (!driver || driver.role !== 'driver') {
    return next(new ErrorResponse('Invalid driver ID or user is not a driver', 400));
  }

  order.driver = driverId;
  // Optionally, update status to 'accepted' upon assignment
  if (order.status === 'pending') {
    order.status = 'accepted';
    order.statusHistory.push({ status: 'accepted', timestamp: new Date() });
  }

  await order.save();

  await recordAuditLog({
    actorId: req.user._id,
    action: 'ORDER_DRIVER_ASSIGNED',
    targetType: 'Order',
    targetId: order._id,
    details: { driverId },
  });

  // --- Emit Socket.IO Event ---
  const io = req.app.get('io');
  io.to(`order:${order._id}`).emit('driver_assigned', { orderId: order._id, driverId: order.driver });

  res.status(200).json({ success: true, data: order });
});

// @desc    Get all orders assigned to the logged-in driver
// @route   GET /api/v1/orders/assigned
// @access  Private (Driver)
exports.getAssignedOrders = asyncHandler(async (req, res, next) => {
  const orders = await Order.find({ driver: req.user._id });
  res.status(200).json({ success: true, count: orders.length, data: orders });
});