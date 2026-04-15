import ReceiptParseJob from '../models/ReceiptParseJob.js';

export const flushStaleReceiptJobs = async ({ dryRun = false }) => {
  console.log('[flushStaleReceiptJobs] Checking for stale jobs.');

  const staleJobs = await ReceiptParseJob.find({
    status: { $in: ['QUEUED', 'CREATED'] },
    updatedAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) }, // 10 minutes
  });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      totalJobs: await ReceiptParseJob.countDocuments(),
      candidates: staleJobs.length,
      stale: staleJobs.length,
      missingCaptureIds: [],
    };
  }

  for (const job of staleJobs) {
    job.status = 'FAILED';
    job.parseError = 'Job timed out in queue.';
    await job.save();
  }

  return {
    ok: true,
    flushed: staleJobs.length,
  };
};
