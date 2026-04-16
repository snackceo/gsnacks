const appEmitter = require('../events/eventEmitter');
const { sendSms, sendPushNotification } = require('./notificationService.js');
const User = require('./models/User.js');

/**
 * Initializes all notification-related event listeners.
 */
const initializeNotificationListeners = () => {
  appEmitter.on('orderStatusUpdated', async ({ order, status }) => {
    const customer = await User.findById(order.user);
    if (!customer) return;

    let message;
    const heading = 'Order Update';

    switch (status) {
      case 'accepted':
        message = `Ninpo Snacks: Your order #${order._id.toString().slice(-6)} has been accepted!`;
        break;
      case 'picked_up':
        message = `Ninpo Snacks: Your order #${order._id.toString().slice(-6)} is out for delivery!`;
        break;
      case 'delivered':
        message = `Ninpo Snacks: Your order #${order._id.toString().slice(-6)} has been delivered. Enjoy!`;
        break;
    }

    if (message) {
      // These can run in parallel without awaiting
      sendSms(customer.phone, message);
      sendPushNotification(customer.oneSignalPlayerId, heading, message);
    }
  });

  console.log('Notification listeners initialized.');
};

module.exports = { initializeNotificationListeners };