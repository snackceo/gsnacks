import express from 'express';

import { authRequired, ownerRequired } from '../utils/helpers.js';
import { getProducts, searchProducts, createProduct, updateProduct, deleteProduct } from '../controllers/products.js';

const router = express.Router();

router.get('/', getProducts);

router.get('/search', authRequired, searchProducts);

router.post('/', authRequired, ownerRequired, createProduct);

router.patch('/:id', authRequired, ownerRequired, updateProduct);

router.delete('/:id', authRequired, ownerRequired, deleteProduct);

export default router;
