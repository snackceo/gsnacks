const Order = require('../models/Order.js');
const Product = require('../models/Product.js');
const User = require('../models/User.js');
const asyncHandler = require('../utils/asyncHandler.js');
const mongoose = require('mongoose');

// @desc    Create new order
// @route   POST /api/v1/orders
// @access  Private (Customer)
exports.addOrderItems = asyncHandler(async (req, res, next) => {
  const { orderItems, shippingAddress } = req.body;

  if (!orderItems || orderItems.length === 0) {
    return res.status(400).json({ success: false, error: 'No order items' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const productIds = orderItems.map(item => item.product);
    const products = await Product.find({ _id: { $in: productIds } }).session(session);

    if (products.length !== productIds.length) {
      const foundIds = new Set(products.map(p => p._id.toString()));
      const missingIds = productIds.filter(id => !foundIds.has(id));
      throw new Error(`One or more products not found: ${missingIds.join(', ')}`);
    }

    const productMap = new Map(products.map(p => [p._id.toString(), p]));
    let calculatedTotalPrice = 0;

    // --- Stock and Price Validation ---
    for (const item of orderItems) {
      const product = productMap.get(item.product);
      if (product.stock < item.quantity) {
        throw new Error(`Not enough stock for ${product.name}. Only ${product.stock} left.`);
      }
      calculatedTotalPrice += product.price * item.quantity;
    }

    const order = new Order({
      user: req.user._id,
      orderItems,
      shippingAddress,
      totalPrice: calculatedTotalPrice,
    });

    const createdOrder = await order.save({ session });

    // --- Decrement Stock ---
    const stockUpdates = orderItems.map(item => ({
      updateOne: {
        filter: { _id: item.product },
        update: { $inc: { stock: -item.quantity } },
      },
    }));

    await Product.bulkWrite(stockUpdates, { session });

    await session.commitTransaction();

    res.status(201).json({ success: true, data: createdOrder });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error adding order items:', error);
    // Let asyncHandler forward the error
    next(error);
  } finally {
    session.endSession();
  }
});

// @desc    Get order by ID
// @route   GET /api/v1/orders/:id
// @access  Private
exports.getOrderById = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id).populate('user', 'name email');

  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  // Check if user is owner of order or admin/owner
  if (order.user._id.toString() !== req.user._id.toString() && !['ADMIN', 'OWNER'].includes(req.user.role)) {
    return res.status(401).json({ success: false, error: 'Not authorized to view this order' });
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
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  // --- Authorization Checks for Drivers ---
  if (req.user.role === 'DRIVER') {
    if (!order.driver) {
      return res.status(400).json({ success: false, error: 'This order has not been assigned to a driver' });
    }
    if (order.driver.toString() !== req.user._id.toString() || !['DELIVERY_STARTED', 'DELIVERED'].includes(status)) {
      return res.status(401).json({ success: false, error: 'Not authorized to update this order to that status' });
    }
  }
  // --- End Authorization Checks ---

  order.status = status;
  order.statusHistory.push({ status, timestamp: new Date() });

  // --- Missing Logic: Increment user's completed order count ---
  if (status === 'DELIVERED') {
    await User.findByIdAndUpdate(order.user, { $inc: { ordersCompleted: 1 } });
  }

  await order.save();

  res.status(200).json({ success: true, data: order });
});

// @desc    Assign a driver to an order
// @route   PUT /api/v1/orders/:id/assign
// @access  Private (Admin/Owner)
exports.assignDriverToOrder = asyncHandler(async (req, res, next) => {
  const { driverId } = req.body;
  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  const driver = await User.findById(driverId);
  if (!driver || driver.role !== 'DRIVER') {
    return res.status(400).json({ success: false, error: 'Invalid driver ID or user is not a driver' });
  }

  order.driver = driver._id;
  // Optionally, update status to 'accepted' upon assignment
  if (order.status === 'PENDING') {
    order.status = 'AUTHORIZED'; // Assuming assignment means it's ready for processing
    order.statusHistory.push({ status: 'AUTHORIZED', timestamp: new Date() });
  }

  await order.save();

  res.status(200).json({ success: true, data: order });
});

// @desc    Get all orders assigned to the logged-in driver
// @route   GET /api/v1/orders/assigned
// @access  Private (Driver)
exports.getAssignedOrders = asyncHandler(async (req, res, next) => {
  const orders = await Order.find({ driver: req.user._id });
  res.status(200).json({ success: true, count: orders.length, data: orders });
});