import * as productService from '../services/productService.js';
import asyncHandler from '../utils/asyncHandler.js';
import { recordAuditLog } from '../services/auditLogService.js';
import ErrorResponse from '../utils/errorResponse.js';

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
    throw new ErrorResponse('image must be a Cloudinary URL', 400);
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

export const getProducts = asyncHandler(async (req, res, next) => {
  const docs = await productService.findProducts();
  const products = docs.map(mapProduct);
  res.status(200).json({ success: true, count: products.length, data: products });
});

export const getProduct = asyncHandler(async (req, res, next) => {
  const paramId = req.params.id;
  const product = await productService.findOneProduct(paramId);

  if (!product) {
    return next(new ErrorResponse(`Product not found with id of ${paramId}`, 404));
  }

  res.status(200).json({ success: true, data: mapProduct(product) });
});

export const searchProducts = asyncHandler(async (req, res, next) => {
  const query = String(req.query?.query || req.query?.q || '').trim();
  if (!query) {
    return res.status(200).json({ success: true, count: 0, data: [] });
  }

  const docs = await productService.searchProducts(query);

  const products = docs.map(doc => ({
    ...mapProduct(doc),
    productId: doc._id.toString()
  }));

  res.status(200).json({ success: true, count: products.length, data: products });
});

export const createProduct = asyncHandler(async (req, res, next) => {
  if (req.body?.sku) {
    return next(new ErrorResponse('SKU generation forbidden on client', 400));
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
  
  if (!name) return next(new ErrorResponse('name is required', 400));
  if (price === undefined || price === null || Number.isNaN(Number(price))) {
    return next(new ErrorResponse('price is required', 400));
  }
  
  const normalizedImage = normalizeProductImageInput(req.body?.image);
  
  const validateString = (val, field, max = 64) => {
    if (val === undefined || val === null) return '';
    if (typeof val !== 'string') throw new ErrorResponse(`${field} must be a string`, 400);
    if (val.length > max) throw new ErrorResponse(`${field} too long (max ${max})`, 400);
    return val.trim();
  };
  
  const safeBrand = validateString(brand, 'brand');
  const safeProductType = validateString(productType, 'productType');
  const safeStorageZone = validateString(storageZone, 'storageZone');
  const safeStorageBin = validateString(storageBin, 'storageBin');
  const normalizedUpc = upc ? String(upc).trim() : '';
  
  const created = await productService.createProduct({
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

  await recordAuditLog({
    actorId: req.user._id,
    action: 'PRODUCT_CREATED',
    targetType: 'Product',
    targetId: created._id,
    details: { productData: req.body },
  });

  res.status(201).json({
    success: true,
    data: mapProduct(created)
  });
});

export const updateProduct = asyncHandler(async (req, res, next) => {
  const paramId = req.params.id;

  const updates = {};
  const allowed = [
    'name', 'price', 'deposit', 'stock', 'sizeOz', 'isTaxable',
    'category', 'brand', 'productType', 'storageZone', 'storageBin',
    'image', 'isGlass', 'isHeavy', 'upc'
  ];

  const validateString = (val, field, max = 64) => {
    if (val === undefined || val === null) return '';
    if (typeof val !== 'string') throw new ErrorResponse(`${field} must be a string`, 400);
    if (val.length > max) throw new ErrorResponse(`${field} too long (max ${max})`, 400);
    return val.trim();
  };

  for (const k of allowed) {
    if (req.body?.[k] !== undefined) {
      if (["brand","productType","storageZone","storageBin"].includes(k)) {
          updates[k] = validateString(req.body[k], k);
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
  if (updates.image !== undefined) updates.image = normalizeProductImageInput(updates.image);
  if (updates.upc !== undefined) {
    const normalizedUpc = String(updates.upc).trim();
    updates.upc = normalizedUpc || '';
  }

  for (const k of ["brand","productType","storageZone","storageBin"]) {
    if (updates[k] === '') updates[k] = '';
  }

  const updated = await productService.updateProduct(paramId, updates);

  if (!updated) return next(new ErrorResponse(`Product not found with id of ${paramId}`, 404));

  await recordAuditLog({
    actorId: req.user._id,
    action: 'PRODUCT_UPDATED',
    targetType: 'Product',
    targetId: updated._id,
    details: { changes: req.body },
  });

  res.status(200).json({
    success: true,
    data: mapProduct(updated)
  });
});

export const deleteProduct = asyncHandler(async (req, res, next) => {
  const paramId = req.params.id;
  const deleted = await productService.deleteProduct(paramId);

  if (!deleted) return next(new ErrorResponse(`Product not found with id of ${paramId}`, 404));
  
  await recordAuditLog({
    actorId: req.user._id,
    action: 'PRODUCT_DELETED',
    targetType: 'Product',
    targetId: deleted._id,
  });

  res.status(200).json({ success: true, data: {} });
});
