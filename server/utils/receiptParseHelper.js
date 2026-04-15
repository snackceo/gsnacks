import ReceiptParseJob from '../models/ReceiptParseJob.js';

export const executeReceiptParse = async (captureId, actor, options = {}) => {
  console.log(`[executeReceiptParse] Executing for captureId: ${captureId}`);
  // This is a placeholder. A real implementation would call Gemini API
  // and do the parsing.

  // Simulate finding a job
  const job = await ReceiptParseJob.findOne({ captureId });

  if (job) {
    job.status = 'PARSED';
    job.rawText = 'Simulated parsed text from receipt.';
    await job.save();
    return job;
  }

  return null;
};
