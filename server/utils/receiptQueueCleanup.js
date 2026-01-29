import mongoose from 'mongoose';
import ReceiptCapture from '../models/ReceiptCapture.js';
import { getReceiptQueue } from '../queues/receiptQueue.js';

const DEFAULT_JOB_STATES = ['wait', 'delayed', 'paused', 'failed'];

const normalizeCaptureId = value => String(value || '').trim();

export const flushStaleReceiptJobs = async ({
  captureIds = null,
  jobStates = DEFAULT_JOB_STATES,
  dryRun = false
} = {}) => {
  const queue = getReceiptQueue({ allowDisabled: true });
  if (!queue) {
    return { ok: false, reason: 'queue_unavailable' };
  }

  const jobs = await queue.getJobs(jobStates);
  const jobsWithCapture = jobs.filter(job => job?.data?.captureId);
  const filterIds = Array.isArray(captureIds)
    ? new Set(captureIds.map(normalizeCaptureId).filter(Boolean))
    : null;

  const filteredJobs = filterIds
    ? jobsWithCapture.filter(job => filterIds.has(normalizeCaptureId(job.data.captureId)))
    : jobsWithCapture;

  const uniqueIds = Array.from(
    new Set(filteredJobs.map(job => normalizeCaptureId(job.data.captureId)).filter(Boolean))
  );

  const validIds = uniqueIds.filter(id => mongoose.Types.ObjectId.isValid(id));
  const invalidIds = uniqueIds.filter(id => !mongoose.Types.ObjectId.isValid(id));

  const existing = validIds.length
    ? await ReceiptCapture.find({ _id: { $in: validIds } }).select('_id').lean()
    : [];
  const existingSet = new Set(existing.map(doc => String(doc._id)));

  const missingCaptureIds = new Set([
    ...invalidIds,
    ...validIds.filter(id => !existingSet.has(id))
  ]);

  const staleJobs = filteredJobs.filter(job => missingCaptureIds.has(normalizeCaptureId(job.data.captureId)));
  const removedJobIds = [];

  if (!dryRun) {
    for (const job of staleJobs) {
      await job.remove();
      removedJobIds.push(job.id);
    }
  }

  return {
    ok: true,
    totalJobs: jobs.length,
    candidates: filteredJobs.length,
    stale: staleJobs.length,
    removed: removedJobIds.length,
    removedJobIds,
    missingCaptureIds: Array.from(missingCaptureIds)
  };
};
