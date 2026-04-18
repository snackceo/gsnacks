const express = require('express');
const router = express.Router();

const adminRoutes = require('./adminRoutes');
const authRoutes = require('./authRoutes');
const bottleReturnRoutes = require('./bottleReturnRoutes');
const orderRoutes = require('./orderRoutes');
const paymentRoutes = require('./paymentRoutes');
const productRoutes = require('./productRoutes');
const errorRoutes = require('./errorRoutes');
const healthRoutes = require('./health');
const distanceRoutes = require('./distance');
const receiptRoutes = require('./receipts');
const upcRoutes = require('./upc');


router.use('/admin', adminRoutes);
router.use('/auth', authRoutes);
router.use('/bottle-returns', bottleReturnRoutes);
router.use('/orders', orderRoutes);
router.use('/payments', paymentRoutes);
router.use('/products', productRoutes);
router.use('/errors', errorRoutes);
router.use('/health', healthRoutes);
router.use('/distance', distanceRoutes);
router.use('/receipts', receiptRoutes);
router.use('/upc', upcRoutes);


// These seem to be legacy or duplicates, based on other files.
// I will not include them for now to avoid conflicts.
// router.use('/ai', require('./ai'));
// router.use('/approvals', require('./approvals'));
// router.use('/audit-logs', require('./audit-logs'));
// router.use('/cart', require('./cart'));
// router.use('/driver', require('./driver'));


module.exports = router;
