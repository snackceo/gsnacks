import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const connectionString = process.env.BULLMQ_URL || process.env.REDIS_URL || process.env.REDIS_CONNECTION_URL || '';
let connection = null;

if (connectionString) {
  connection = new IORedis(connectionString, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });

  connection.on('error', err => {
    console.error('Redis connection error (BullMQ):', err.message);
  });
} else {
  console.warn('BullMQ connection not configured; receipt queue is disabled.');
}

const queueName = 'receipt-learning';

const receiptQueue = connection && String(process.env.ENABLE_RECEIPT_QUEUE || 'false').toLowerCase() === 'true'
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

export const getReceiptQueueEvents = () => receiptQueueEvents;
