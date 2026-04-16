import crypto from 'crypto';
import { approveReceiptJobHandler } from '../controllers/receipts.controller.js';

import { isReceiptAutoCommitEnabled } from '../utils/featureFlags.js';
export { isReceiptAutoCommitEnabled };

const createMockRes = () => {
  const result = {
    statusCode: 200,
    body: null
  };

  return {
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(payload) {
      result.body = payload;
      return this;
    },
    getResult() {
      return result;
    }
  };
};

export const approveReceiptJob = async ({ jobId, user, body = {} }) => {
  const req = {
    params: { jobId },
    body,
    user
  };
  const res = createMockRes();
  await approveReceiptJobHandler(req, res);
  return res.getResult();
};

export const buildAutoCommitApprovalBody = ({ captureId }) => ({
  mode: 'all',
  strictValidation: true,
  autoCommit: true,
  idempotencyKey: `auto-${captureId}-${crypto.randomUUID()}`
});
