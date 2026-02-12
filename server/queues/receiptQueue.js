import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { parseBoolWithReason } from '../utils/featureFlags.js';

const redisUrl = process.env.REDIS_URL || '';
const queueName = 'receipt-parse';

let connection = null;

if (redisUrl) {
  connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });

  connection.on('ready', () => {
    console.log('Redis connected for BullMQ receipt queue.');
  });

  connection.on('error', err => {
    console.error('Redis connection error (BullMQ):', err.message);
  });
} else {
  console.warn('BullMQ connection not configured; receipt queue is disabled.');
}

const receiptQueueFlag = parseBoolWithReason(process.env.ENABLE_RECEIPT_QUEUE, false);

const receiptQueue = connection && receiptQueueFlag.value
  ? new Queue(queueName, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
      }
    })
  : null;

const normalizedReceiptQueueConfig = {
  queueName,
  redisConfigured: Boolean(redisUrl),
  enableReceiptQueueRaw: receiptQueueFlag.raw,
  enableReceiptQueueNormalized: receiptQueueFlag.normalized,
  enableReceiptQueue: receiptQueueFlag.value,
  decisionReason: connection
    ? receiptQueueFlag.reason
    : `${receiptQueueFlag.reason}; Redis unavailable`
};

console.log(
  `BullMQ receipt queue config: ${JSON.stringify(normalizedReceiptQueueConfig)}`
);

if (receiptQueue) {
  console.log('BullMQ receipt queue enabled.');
} else {
  console.log('BullMQ receipt queue disabled by config or missing Redis connection.');
}

let receiptQueueAdmin = null;

const receiptQueueEvents = connection ? new QueueEvents(queueName, { connection }) : null;

export const isReceiptQueueEnabled = () => Boolean(receiptQueue);

export const enqueueReceiptJob = async (name, data, options = {}) => {
  if (!receiptQueue) {
    return { ok: false, skipped: true, reason: 'queue_disabled' };
  }
  const job = await receiptQueue.add(name, data, options);
  return { ok: true, jobId: job.id };
};

export const registerReceiptWorker = (processor) => {
  if (!connection) {
    console.warn('Receipt worker not started because Redis is not configured.');
    return null;
  }
  return new Worker(queueName, processor, {
    connection,
    concurrency: Number(process.env.RECEIPT_WORKER_CONCURRENCY || 2),
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 }
  });
};

export const getReceiptQueue = ({ allowDisabled = false } = {}) => {
  if (receiptQueue) {
    return receiptQueue;
  }
  if (!allowDisabled || !connection) {
    return null;
  }
  if (!receiptQueueAdmin) {
    receiptQueueAdmin = new Queue(queueName, { connection });
  }
  return receiptQueueAdmin;
};

export const getReceiptQueueEvents = () => receiptQueueEvents;
