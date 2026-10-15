/**
 * @title cuid2 primary-key generator
 * @notice Opaque, collision-resistant, URL-safe ids for primary keys.
 * @dev Replaces Prisma's `@default(cuid())`. The format is deliberately kept
 * @dev identical in shape (leading `c`, base36, ~25 chars) so ids already stored
 * @dev in staging/main stay valid and clients see no change.
 * @dev Layout: `c` + base36 timestamp (8) + base36 counter (4) + base36 random
 * @dev (12). The timestamp prefix keeps ids roughly sortable by creation time,
 * @dev and the random suffix keeps them unguessable — these ids are handed to
 * @dev clients in URLs, so they must not be sequential.
 */
const crypto = require('node:crypto');

let counter = crypto.randomInt(0, 1296);

/**
 * @dev Widest value representable in 12 base36 digits. A 64-bit random number
 * @dev needs 13 base36 digits, which would make the id length vary between 25
 * @dev and 26 characters and defeat the constant-length guarantee below.
 */
const RANDOM_RANGE = 36n ** 12n;

/**
 * @notice Roll the counter over before it can exceed 36^4.
 * @dev Re-seeding from random bytes (rather than resetting to 0) means two ids
 * @dev minted in the same millisecond after a rollover still differ in their
 * @dev random half.
 * @return {void}
 */
const rollCounter = () => {
  counter = crypto.randomInt(0, 1296);
};

/**
 * @notice Generate a new cuid2 id.
 * @dev 12 random base36 digits, so the id is always exactly 25 characters. A
 * @dev variable-length id would sort unpredictably inside the composite indexes
 * @dev the chat and notification keyset pagination scan.
 * @dev The modulo below folds 64 random bits into 12 base36 digits. The bias it
 * @dev introduces is under 2^-40 of the range and the value is an
 * @dev anti-guessing salt rather than a secret, so it is not worth more entropy.
 * @return {string} A 25-character id, e.g. `clx0a1b2c3d4e5f6g7h8i9j0k`.
 */
const cuid2 = () => {
  counter += 1;
  if (counter >= 1296) rollCounter();
  const timestamp = Date.now().toString(36).padStart(8, '0');
  const count = counter.toString(36).padStart(4, '0');
  const raw = crypto.randomBytes(8).readBigUInt64BE() % RANDOM_RANGE;
  return `c${timestamp}${count}${raw.toString(36).padStart(12, '0')}`;
};

module.exports = { cuid2 };