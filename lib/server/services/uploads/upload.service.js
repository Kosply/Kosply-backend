/**
 * @title Upload service (listing photos, avatars, chat images)
 * @notice Stores one image the phone sent and returns the public URL every
 * @notice other route already expects (`products.imageUrls`, `users.photo`,
 * @notice `messages.imageUrl`).
 * @dev **Why this exists.** Those columns only ever held `http(s)` URLs and the
 * @dev server had no way to receive bytes, so the Flutter camera flow could take
 * @dev photos but had nowhere to put them. The listing agent (`listing.md`) has
 * @dev the same contract: it is handed URLs, never a binary payload.
 * @dev **What is trusted.** Nothing about the body. The declared content type
 * @dev picks the extension only after the leading bytes agree with it, so a
 * @dev script labelled `image/png` is refused instead of being served back from
 * @dev our own origin. The file name is a fresh cuid2 — the client never names a
 * @dev file, so there is no path to traverse and no name to collide with.
 * @dev **Where files go.** `UPLOAD_DIR` (default `<repo>/uploads`), served
 * @dev read-only under `/uploads` by `app.js`. Local disk is the development
 * @dev answer; behind PM2 cluster mode or several hosts this directory must be
 * @dev shared storage, or the route swapped for object storage with the same
 * @dev response shape.
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const { throwError } = require('../../middlewares/errorCatalog');
const { cuid2 } = require('../../../db/src/ids');

/** @dev Largest accepted image. A 720p phone JPEG is ~300 KB; 8 MB is headroom. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * @dev Accepted types, each with the magic bytes that must open the file.
 * @dev WEBP is `RIFF....WEBP`, so it is checked at two offsets.
 */
const IMAGE_TYPES = {
  'image/jpeg': { ext: 'jpg', matches: (buf) => buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff },
  'image/png': {
    ext: 'png',
    matches: (buf) => buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  'image/webp': {
    ext: 'webp',
    matches: (buf) =>
      buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP',
  },
};

/** @dev The public path prefix `app.js` serves the directory under. */
const PUBLIC_PREFIX = '/uploads';

/**
 * @notice Resolve the directory uploads are written to.
 * @dev Read on every call so a test can point it at a temp directory.
 * @return {string} Absolute directory path.
 */
const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../../../uploads'));

/**
 * @notice Normalise a `Content-Type` header to its bare media type.
 * @param {string|undefined} header Raw header value.
 * @return {string} Lowercase media type, e.g. `image/jpeg`.
 */
const mediaTypeOf = (header) => String(header || '').split(';')[0].trim().toLowerCase();

/**
 * @notice Store one image and return where it can be fetched.
 * @dev `publicBase` is the origin the phone reached us on (or `PUBLIC_BASE_URL`),
 * @dev so the URL works for the device that uploaded it — a LAN IP in
 * @dev development, the real domain behind a proxy.
 * @param {Buffer|undefined} body Raw request body from `express.raw`.
 * @param {string|undefined} contentType Request `Content-Type`.
 * @param {string} publicBase Origin to build the URL on, without a trailing slash.
 * @return {Promise<object>} `{ url, contentType, size }`.
 */
const saveImage = async (body, contentType, publicBase) => {
  const type = IMAGE_TYPES[mediaTypeOf(contentType)];
  if (!type) throwError('UNSUPPORTED_MEDIA_TYPE', { details: 'send image/jpeg, image/png or image/webp' });
  // `express.raw` leaves `{}` when the type did not match its filter, so a
  // non-Buffer body is the same "nothing usable arrived" case as an empty one.
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throwError('VALIDATION', { details: 'image body is empty' });
  }
  if (body.length > MAX_IMAGE_BYTES) throwError('PAYLOAD_TOO_LARGE');
  if (!type.matches(body)) {
    throwError('UNSUPPORTED_MEDIA_TYPE', { details: 'the bytes do not match the declared image type' });
  }

  const name = `${cuid2()}.${type.ext}`;
  const dir = uploadDir();
  await fs.mkdir(dir, { recursive: true });
  // `wx`: a cuid2 collision must fail loudly rather than overwrite a photo.
  await fs.writeFile(path.join(dir, name), body, { flag: 'wx' });

  return {
    url: `${publicBase.replace(/\/$/, '')}${PUBLIC_PREFIX}/${name}`,
    contentType: mediaTypeOf(contentType),
    size: body.length,
  };
};

module.exports = { saveImage, uploadDir, IMAGE_TYPES, MAX_IMAGE_BYTES, PUBLIC_PREFIX };
