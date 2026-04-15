import ReceiptParseJob from '../models/ReceiptParseJob.js';

export const transitionReceiptParseJobStatus = async ({ captureId, actor, status, updates }) => {
  console.log(`[transitionReceiptParseJobStatus] Transitioning captureId ${captureId} to ${status}`);

  const job = await ReceiptParseJob.findOneAndUpdate(
    { captureId },
    {
      $set: {
        status,
        ...updates,
      },
      $push: {
        history: {
          status,
          actor,
          timestamp: new Date(),
        },
      },
    },
    { new: true, upsert: true }
  );

  return job;
};
