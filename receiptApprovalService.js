import ReceiptParseJob from '../../models/ReceiptParseJob.js';
import ReceiptCapture from '../../models/ReceiptCapture.js';
import Store from '../../models/Store.js';
import { recordAuditLog } from '../../utils/audit.js';
import { transitionReceiptParseJobStatus } from '../../utils/receiptParseJobStatus.js';

export const approveJob = async (jobId, payload, actor) => {
  const {
    finalStoreId,
    confirmStoreCreate,
    storeCandidate,
    items: approvalItems,
  } = payload;

  const job = await ReceiptParseJob.findById(jobId);
  if (!job) {
    throw new Error('ReceiptParseJob not found');
  }

  const capture = await ReceiptCapture.findById(job.captureId);
  if (!capture) {
    throw new Error('ReceiptCapture not found');
  }

  let store;
  if (finalStoreId) {
    store = await Store.findById(finalStoreId);
  } else if (confirmStoreCreate && storeCandidate?.name) {
    store = await Store.create({
      name: storeCandidate.name,
      address: storeCandidate.address,
      phone: storeCandidate.phone,
      storeType: storeCandidate.storeType,
    });
  }

  if (!store) {
    throw new Error('Store could not be resolved or created.');
  }

  capture.storeId = store._id;
  capture.storeName = store.name;

  // Here, you would process the `approvalItems` to update inventory,
  // create products, link UPCs, etc. This logic can be quite complex.
  // For now, we'll just mark the job as approved.

  await transitionReceiptParseJobStatus({
    captureId: capture._id.toString(),
    actor,
    status: 'APPROVED',
  });

  await capture.save();

  await recordAuditLog({ type: 'receipt_job_approved', actorId: actor, details: `jobId=${jobId} storeId=${store._id}` });

  return { job, capture, store };
};