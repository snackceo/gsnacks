import Product from '../models/Product.js';
import { generateSku } from '../utils/sku.js';

const PRODUCT_IMAGE_FALLBACK_URL =
  process.env.PRODUCT_IMAGE_FALLBACK_URL ||
  'https://res.cloudinary.com/demo/image/upload/w_600,h_600,c_fill,l_text:arial_36:Image%20Unavailable/sample.jpg';

const isCloudinaryUrl = value => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname.endsWith('cloudinary.com') || url.hostname.endsWith('res.cloudinary.com');
  } catch {
    return false;
  }
};

const normalizeProductImageInput = value => {
  if (value === undefined || value === null || value === '') return '';
  const url = String(value).trim();
  if (!isCloudinaryUrl(url)) {
    throw new Error('image must be a Cloudinary URL');
  }
  return url;
};

const resolveProductImage = value => {
  if (value && String(value).trim()) {
    return String(value).trim();
  }
  return PRODUCT_IMAGE_FALLBACK_URL;
};

const mapProduct = d => ({
  id: d.sku || d.frontendId,
  sku: d.sku || undefined,
  upc: d.upc || undefined,
  frontendId: d.frontendId,
  productId: d._id?.toString(),
  name: d.name,
  price: d.price,
  deposit: d.deposit ?? 0,
  stock: d.stock ?? 0,
  sizeOz: d.sizeOz ?? 0,
  isTaxable: d.isTaxable !== undefined ? !!d.isTaxable : true,
  category: d.category ?? 'DRINK',
  image: resolveProductImage(d.image),
  brand: d.brand || '',
  productType: d.productType || '',
  storageZone: d.storageZone || '',
  storageBin: d.storageBin || '',
  isGlass: !!d.isGlass,
  isHeavy: !!d.isHeavy
});

export const getProducts = async (_req, res) => {
  try {
    const docs = await Product.find({}).sort({ createdAt: -1 }).lean();
    const products = docs.map(mapProduct);
    res.json({ ok: true, products });
  } catch (err) {
    console.error('GET PRODUCTS ERROR:', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
};

export const searchProducts = async (req, res) => {
  try {
    const query = String(req.query?.query || req.query?.q || '').trim();
    if (!query) {
      return res.json({ ok: true, products: [] });
    }

    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const docs = await Product.find({
      $or: [{ name: regex }, { sku: regex }, { upc: regex }]
    })
      .sort({ updatedAt: -1 })
      .limit(25)
      .lean();

    const products = docs.map(doc => ({
      ...mapProduct(doc),
      productId: doc._id.toString()
    }));

    res.json({ ok: true, products });
  } catch (err) {
    console.error('SEARCH PRODUCTS ERROR:', err);
    res.status(500).json({ error: 'Failed to search products' });
  }
};

export const createProduct = async (req, res) => {
  try {
    if (req.body?.sku) {
      return res.status(400).json({ error: 'SKU generation forbidden on client' });
    }

    const {
      name,
      price,
      deposit,
      stock,
      sizeOz,
      category,
      image,
      isGlass,
      brand,
      productType,
      storageZone,
      storageBin,
      isHeavy,
      isTaxable,
      upc
    } = req.body || {};
    const normalizedUpc = upc ? String(upc).trim() : '';
    let normalizedImage = '';

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (price === undefined || price === null || Number.isNaN(Number(price))) {
      return res.status(400).json({ error: 'price is required' });
    }
    try {
      normalizedImage = normalizeProductImageInput(req.body?.image);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    // Validate storage fields
    const validateString = (val, field, max = 64) => {
      if (val === undefined || val === null) return '';
      if (typeof val !== 'string') throw new Error(`${field} must be a string`);
      if (val.length > max) throw new Error(`${field} too long (max ${max})`);
      return val.trim();
    };
    let safeBrand, safeProductType, safeStorageZone, safeStorageBin;
    try {
      safeBrand = validateString(brand, 'brand');
      safeProductType = validateString(productType, 'productType');
      safeStorageZone = validateString(storageZone, 'storageZone');
      safeStorageBin = validateString(storageBin, 'storageBin');
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Generate a SKU and use it as frontendId for backwards compatibility
    const sku = await generateSku();
    const created = await Product.create({
      frontendId: sku,
      sku,
      name,
      price: Number(price),
      deposit: Number(deposit || 0),
      stock: Number(stock || 0),
      sizeOz: Number(sizeOz || 0),
      isTaxable: isTaxable !== undefined ? !!isTaxable : true,
      category: category || 'DRINK',
      image: normalizedImage,
      isGlass: !!isGlass,
      brand: safeBrand,
      productType: safeProductType,
      storageZone: safeStorageZone,
      storageBin: safeStorageBin,
      isHeavy: !!isHeavy,
      upc: normalizedUpc || undefined
    });

    res.json({
      ok: true,
      product: mapProduct(created)
    });
  } catch (err) {
    console.error('CREATE PRODUCT ERROR:', err);
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Product ID already exists' });
    }
    res.status(500).json({ error: 'Failed to create product' });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const paramId = req.params.id;

    const updates = {};
    const allowed = [
      'name',
      'price',
      'deposit',
      'stock',
      'sizeOz',
      'isTaxable',
      'category',
      'brand',
      'productType',
      'storageZone',
      'storageBin',
      'image',
      'isGlass',
      'isHeavy',
      'upc'
    ];

    // Validate and normalize string fields
    const validateString = (val, field, max = 64) => {
      if (val === undefined || val === null) return '';
      if (typeof val !== 'string') throw new Error(`${field} must be a string`);
      if (val.length > max) throw new Error(`${field} too long (max ${max})`);
      return val.trim();
    };

    for (const k of allowed) {
      if (req.body?.[k] !== undefined) {
        if (["brand","productType","storageZone","storageBin"].includes(k)) {
          try {
            updates[k] = validateString(req.body[k], k);
          } catch (e) {
            return res.status(400).json({ error: e.message });
          }
        } else {
          updates[k] = req.body[k];
        }
      }
    }

    if (updates.price !== undefined) updates.price = Number(updates.price);
    if (updates.deposit !== undefined) updates.deposit = Number(updates.deposit);
    if (updates.stock !== undefined) updates.stock = Number(updates.stock);
    if (updates.sizeOz !== undefined) updates.sizeOz = Number(updates.sizeOz);
    if (updates.isGlass !== undefined) updates.isGlass = !!updates.isGlass;
    if (updates.isHeavy !== undefined) updates.isHeavy = !!updates.isHeavy;
    if (updates.isTaxable !== undefined) updates.isTaxable = !!updates.isTaxable;
    if (updates.image !== undefined) {
      try {
        updates.image = normalizeProductImageInput(updates.image);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }
    if (updates.upc !== undefined) {
      const normalizedUpc = String(updates.upc).trim();
      if (normalizedUpc) {
        updates.upc = normalizedUpc;
      } else {
        delete updates.upc;
      }
    }
    // If any of the storage fields are set to empty string, persist as empty string (never undefined/null)
    for (const k of ["brand","productType","storageZone","storageBin"]) {
      if (updates[k] === '') updates[k] = '';
    }

    const updated = await Product.findOneAndUpdate(
      { $or: [{ frontendId: paramId }, { sku: paramId }] },
      updates,
      {
        new: true
      }
    ).lean();

    if (!updated) return res.status(404).json({ error: 'Product not found' });

    res.json({
      ok: true,
      product: mapProduct(updated)
    });
  } catch (err) {
    console.error('UPDATE PRODUCT ERROR:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const paramId = req.params.id;
    const deleted = await Product.findOneAndDelete({ $or: [{ frontendId: paramId }, { sku: paramId }] }).lean();
    if (!deleted) return res.status(404).json({ error: 'Product not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE PRODUCT ERROR:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
};