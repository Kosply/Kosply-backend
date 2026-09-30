/**
 * @title API route aggregator
 * @notice Mounts every feature route under `/api`.
 * @dev Register new modules here (e.g. `/auth`), never in `app.js`,
 * @dev so `app.js` stays lean and module wiring stays in one place.
 */
const express = require('express');
const healthRoute = require('./health.route');
const internalRoute = require('./ai/internal.route');
const authRoute = require('./auth/auth.route');
const productRoute = require('./products/product.route');
const aiRoute = require('./ai/ai.route');
const verificationRoute = require('./verifications/verification.route');
const chatRoute = require('./chat/chat.route');
const supportRoute = require('./support/support.route');
const reportRoute = require('./reports/report.route');
const adminRoute = require('./admin/admin.route');
const passwordRoute = require('./auth/password.route');
const modelRoute = require('./models/model.route');
const userRoute = require('./users/user.route');
const notificationRoute = require('./notifications/notification.route');

const router = express.Router();

router.use('/health', healthRoute);
router.use('/internal', internalRoute);
router.use('/auth', authRoute);
router.use('/auth', passwordRoute);
router.use('/products', productRoute);
router.use('/ai', aiRoute);
router.use('/verifications', verificationRoute);
router.use('/conversations', chatRoute);
router.use('/support', supportRoute);
router.use('/reports', reportRoute);
router.use('/admin', adminRoute);
router.use('/models', modelRoute);
router.use('/users', userRoute);
router.use('/notifications', notificationRoute);

// Example: router.use('/auth', require('./auth.route'));

module.exports = router;
