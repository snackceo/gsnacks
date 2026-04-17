const Stripe = require('stripe');
const asyncHandler = require('../utils/asyncHandler.js');
const ErrorResponse = require('../utils/errorResponse');
const Order = require('../models/Order.js');
const Product = require('../models/Product.js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// @desc    Create Stripe checkout session
// @route   POST /api/v1/orders/:orderId/checkout-session
// @access  Private (Customer)
exports.createCheckoutSession = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.orderId);

  if (!order) {
    return next(new ErrorResponse('Order not found', 404));
  }

  if (order.user.toString() !== req.user._id.toString()) {
    return next(new ErrorResponse('Not authorized to pay for this order', 401));
  }

  if (order.isPaid) {
    return next(new ErrorResponse('Order is already paid', 400));
  }

  const line_items = order.orderItems.map((item) => {
    return {
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
        },
        unit_amount: item.price * 100, // Amount in cents
      },
      quantity: item.quantity,
    };
  });

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items,
    mode: 'payment',
    success_url: `${process.env.FRONTEND_URL}/orders/${order._id}?success=true`,
    cancel_url: `${process.env.FRONTEND_URL}/orders/${order._id}?canceled=true`,
    customer_email: req.user.email,
    client_reference_id: req.params.orderId, // Link session to our order
  });

  res.status(200).json({ success: true, id: session.id });
});

// @desc    Stripe webhook for payment verification
// @route   POST /api/v1/stripe-webhook
// @access  Public (called by Stripe)
exports.stripeWebhook = asyncHandler(async (req, res, next) => {
  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.client_reference_id;

    const order = await Order.findById(orderId);

    if (order && !order.isPaid) {
      order.isPaid = true;
      order.paidAt = Date.now();
      order.paymentIntentId = session.payment_intent;
      await order.save();
    }
  }

  res.status(200).json({ received: true });
});
 