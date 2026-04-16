import { getHealthStatus } from '../../services/receipt/receiptHealthService.js';

export const getReceiptHealth = async (req, res, next) => {
  try {
    const healthStatus = await getHealthStatus({
      storeId: req.query?.storeId
    });
    res.json({ ok: true, ...healthStatus });
  } catch (error) {
    console.error('Error fetching receipt health:', error);
    next(error);
  }
};