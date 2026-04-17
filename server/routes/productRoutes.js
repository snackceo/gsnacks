import express from 'express';
import {
  getProducts,
  getProduct,
  searchProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../controllers/productController.js';

const router = express.Router();

// These imports are CommonJS, they should be updated if the project migrates fully.
import { protect, authorize } from '../middleware/auth.js';

router.route('/search').get(searchProducts);

router
  .route('/')
  .get(getProducts)
  .post(protect, authorize('admin', 'owner'), createProduct);

router
  .route('/:id')
  .get(getProduct)
  .put(protect, authorize('admin', 'owner'), updateProduct)
  .delete(protect, authorize('admin', 'owner'), deleteProduct);

export default router;