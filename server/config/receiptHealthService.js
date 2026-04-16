import ReceiptCapture from '../../models/ReceiptCapture.js';
import { isDbReady } from '../../db/connect.js';
import { getReceiptIngestionGateState, isPricingLearningEnabled } from '../../utils/featureFlags.js';
import { flushStaleReceiptJobs } from '../../utils/receiptQueueCleanup.js';
import { getReceiptQueueWorkerHealth, isReceiptQueueEnabled } from '../../queues/receiptQueue.js';
import { computeReceiptOcrSuccessSummary, hasCloudinary } from './receiptValidationService.js';

export const getHealthStatus = async ({ storeId }) => {
  if (!isDbReady()) {
    const error = new Error('Database not ready');
    error.statusCode = 503;
    throw error;
  }

  const requestedStoreId =
    typeof storeId === 'string' && storeId.trim().length > 0
      ? storeId.trim()
      : null;

  const ingestionGate = await getReceiptIngestionGateState({ storeId: requestedStoreId });
  const staleJobCheck = await flushStaleReceiptJobs({ dryRun: true });
  const sevenDayWindowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const ocrSummarySamples = await ReceiptCapture.find({
    lastParseAt: { $gte: sevenDayWindowStart },
    'parseMetrics.providerUsed': { $exists: true, $ne: null }
  })
    .select('status parseMetrics.providerAttempted parseMetrics.providerUsed parseMetrics.fallbackReason')
    .lean();

  return {
    cloudinary: hasCloudinary,
    queueEnabled: isReceiptQueueEnabled(),
    queueStatus: await getReceiptQueueWorkerHealth(),
    learningEnabled: isPricingLearningEnabled(),
    ingestionGate,
    staleReceiptJobs: staleJobCheck,
    ocrProviderSummary7d: computeReceiptOcrSuccessSummary(ocrSummarySamples)
  };
};