import ReceiptParseJob from '../models/ReceiptParseJob.js';
import { recordAuditLog } from './audit.js';

export const transitionReceiptParseJobStatus = async ({ captureId, actor = 'system', status, updates = {} }) => {
  const existing = await ReceiptParseJob.findOne({ captureId }).select('status').lean();
  const previousStatus = existing?.status || null;

  const next = await ReceiptParseJob.findOneAndUpdate(
    { captureId },
    {
      captureId,
      ...updates,
      status
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  if (previousStatus !== status) {
    await recordAuditLog({
      type: 'receipt_parse_job_status_transition',
      actorId: actor,
      details: `captureId=${captureId} oldStatus=${previousStatus || 'NONE'} newStatus=${status} actor=${actor}`
    });
  }

  return next;
};
