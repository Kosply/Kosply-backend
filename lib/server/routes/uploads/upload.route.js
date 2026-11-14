/**
 * @title Upload routes
 * @notice Image uploads for listings, avatars and chat.
 * @dev The body is the raw image (`Content-Type: image/jpeg|png|webp`), not
 * @dev multipart: one file per request keeps the route dependency-free and lets
 * @dev the phone stream a photo straight from disk. `express.raw` is mounted
 * @dev here only, so the global 1 MB JSON limit still guards every other route.
 * @dev Authenticated and throttled: an open upload endpoint is free hosting.
 */
const express = require('express');
const uploads = require('../../controllers/uploads/upload.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate } = require('../../middlewares/auth/auth');
const { rateLimit } = require('../../middlewares/rateLimit');
const { IMAGE_TYPES, MAX_IMAGE_BYTES } = require('../../services/uploads/upload.service');

const router = express.Router();

router.post(
  '/images',
  authenticate,
  rateLimit({ name: 'upload', limit: 120, windowMs: 15 * 60_000 }),
  express.raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_IMAGE_BYTES }),
  asyncHandler(uploads.image)
);

module.exports = router;
