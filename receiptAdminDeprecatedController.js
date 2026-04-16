/**
 * @deprecated Sunset plan: migrate all callers to the new /api/receipts endpoints and remove after 2026-09-30.
 */
export const postReceiptParseJobsApprove = (req, res) => {
  // TODO: Implementation for approving parse jobs
  res.status(200).send('OK');
};

export const postReceiptParseJobsReject = (req, res) => {
  // TODO: Implementation for rejecting parse jobs
  res.status(200).send('OK');
};