/**
 * @title User reads that need the seller verification attached
 * @notice Reads a user together with their verification row.
 * @dev `chat.open` needs both to decide whether the counterparty is a real,
 * @dev active seller: the `users.role` claim alone cannot express "approved
 * @dev but frozen", which is exactly the state a banned seller is in.
 */
const db = require('../db');
const { attachMany, attachOne } = require('./relations');

/** @dev Relation description reused by every read in this file. */
const VERIFICATION = {
  key: 'id',
  targetTable: 'seller_verifications',
  columns: ['status', 'isActive'],
  on: 'sellerVerification',
};

/**
 * @notice Attach each user's verification row under `sellerVerification`.
 * @dev The foreign key lives on `seller_verifications.userId` and points back at
 * @dev the user, so the join key on the parent side is `id` — the same column
 * @dev name as the target's primary key but the opposite direction.
 * @param {Array<object>} rows Users.
 * @return {Promise<Array<object>>} Users with `sellerVerification` (or null).
 */
const withVerifications = (rows) => attachMany(rows, {
  ...VERIFICATION,
  key: 'id',
  match: 'userId',
});

/**
 * @notice Read one user with their verification attached.
 * @param {object} opts See `db.selectOne`.
 * @return {Promise<object|null>} User with `sellerVerification`, or null.
 */
const oneWithVerification = async (opts) => attachOne(await db.selectOne('users', opts), {
  ...VERIFICATION,
  key: 'id',
  match: 'userId',
});

module.exports = { VERIFICATION, oneWithVerification, withVerifications };