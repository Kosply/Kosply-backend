/**
 * @title Admin routes (dashboard login, separate credentials)
 */
const express = require('express');
const admin = require('../../controllers/admin/admin.controller');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

router.post('/login', asyncHandler(admin.login));

module.exports = router;
