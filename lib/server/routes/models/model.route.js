/**
 * @title Model routes (selector source + admin registry)
 * @notice Public list shows active models only; writes need role ADMIN.
 */
const express = require('express');
const models = require('../../controllers/models/model.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate, requireRole } = require('../../middlewares/auth/auth');

const router = express.Router();

router.get('/', asyncHandler(models.listActive));
router.use(authenticate, requireRole('ADMIN'));
router.post('/', asyncHandler(models.create));
router.patch('/:id', asyncHandler(models.update));
router.delete('/:id', asyncHandler(models.remove));

module.exports = router;
