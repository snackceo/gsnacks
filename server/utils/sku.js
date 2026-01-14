import Counter from '../models/Counter.js';

async function generateSku(prefix = 'NP') {
  // Atomically increment counter and return formatted SKU
  const doc = await Counter.findByIdAndUpdate(
    'product_sku',
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  const value = Number(doc?.value || 0);
  const padded = String(value).padStart(6, '0');
  return `${prefix}-${padded}`;
}

export { generateSku };
