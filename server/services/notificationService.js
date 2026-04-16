const Twilio = require('twilio');
const OneSignal = require('@onesignal/node-onesignal');

let twilioClient;
if (process.env.TWILIO_ACCOUNT_SID) {
  twilioClient = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

let oneSignalClient;
if (process.env.ONESIGNAL_APP_ID) {
  const configuration = OneSignal.createConfiguration({
    userKey: process.env.ONESIGNAL_USER_KEY,
    appKey: process.env.ONESIGNAL_REST_API_KEY,
  });
  oneSignalClient = new OneSignal.DefaultApi(configuration);
}

/**
 * Sends an SMS notification using Twilio.
 * @param {string} to - The recipient's phone number.
 * @param {string} body - The message body.
 */
exports.sendSms = async (to, body) => {
  if (!twilioClient || !to) {
    console.log('Twilio not configured or no phone number provided. Skipping SMS.');
    return;
  }
  try {
    await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });
  } catch (error) {
    console.error('Error sending SMS via Twilio:', error);
  }
};

/**
 * Sends a push notification using OneSignal.
 * @param {string} playerId - The OneSignal player ID of the recipient.
 * @param {string} heading - The notification heading.
 * @param {string} content - The notification content.
 */
exports.sendPushNotification = async (playerId, heading, content) => {
  if (!oneSignalClient || !playerId) {
    console.log('OneSignal not configured or no player ID provided. Skipping push notification.');
    return;
  }
  const notification = new OneSignal.Notification();
  notification.app_id = process.env.ONESIGNAL_APP_ID;
  notification.include_player_ids = [playerId];
  notification.headings = { en: heading };
  notification.contents = { en: content };

  try {
    await oneSignalClient.createNotification(notification);
  } catch (error) {
    console.error('Error sending push notification via OneSignal:', error);
  }
};