/**
 * @title User service (public profile + self-service update)
 * @notice Everyone has name + username; sellers add bio; photo is a URL.
 * @dev Email and password are locked here (dedicated flows own them):
 * @dev sending either yields VALIDATION instead of silent ignore.
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const { toText, assertSafeUrl } = require('../shared/validators');

const PUBLIC_PROFILE_SELECT = {
  id: true,
  username: true,
  name: true,
  role: true,
  universitas: true,
  programStudi: true,
  bio: true,
  photo: true,
};

const EDITABLE = ['name', 'username', 'bio', 'photo', 'universitas', 'programStudi'];
/** @dev Columns that may be set to null (the rest are NOT NULL in the schema). */
const NULLABLE = ['bio', 'photo'];
const LOCKED = ['email', 'password', 'passwordHash'];

/**
 * @notice Read any public profile by id.
 * @param {string} id User id.
 * @return {Promise<object>} Public profile or throws `USER_NOT_FOUND`.
 */
const profile = async (id) => {
  const prisma = requireDb();
  const user = await prisma.user.findUnique({ where: { id }, select: PUBLIC_PROFILE_SELECT });
  if (!user) throwError('USER_NOT_FOUND');
  return user;
};

/**
 * @notice Read the caller's own profile.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} Public profile.
 */
const me = async (actor) => profile(actor.id);

/**
 * @notice Update the caller's profile (whitelisted fields only).
 * @param {object} input Raw body fields.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} Updated public profile.
 */
const updateMe = async (input = {}, actor) => {
  const prisma = requireDb();
  for (const key of LOCKED) {
    if (input[key] !== undefined) {
      throwError('VALIDATION', { details: `${key} is locked (use its dedicated flow)` });
    }
  }
  const data = {};
  for (const key of EDITABLE) {
    if (input[key] === undefined) continue;
    // `String(null)` is the literal "null" and `String({})` is
    // "[object Object]", so null/objects were stored as garbage: sending
    // `{ username: null }` squatted the username "null" for the whole platform.
    if (input[key] === null) {
      // Only genuinely nullable columns may be cleared.
      if (!NULLABLE.includes(key)) {
        throwError('VALIDATION', { details: `${key} cannot be null` });
      }
      data[key] = null;
      continue;
    }
    if (key === 'photo') {
      data[key] = assertSafeUrl(input[key], 'photo', { maxLength: 512 });
      continue;
    }
    if (key === 'bio') {
      data[key] = toText(input[key], 'bio', { min: 0, max: 2000 });
      continue;
    }
    const value = toText(input[key], key, { min: key === 'username' ? 3 : 1, max: 200 });
    if (key === 'username' && value.length < 3) {
      throwError('VALIDATION', { details: 'username needs 3+ characters' });
    }
    data[key] = value;
  }
  if (data.username) {
    const taken = await prisma.user.findUnique({ where: { username: data.username }, select: { id: true } });
    if (taken && taken.id !== actor.id) throwError('USERNAME_TAKEN');
  }
  try {
    return await prisma.user.update({
      where: { id: actor.id },
      data,
      select: PUBLIC_PROFILE_SELECT,
    });
  } catch (err) {
    // A concurrent update to the same username is a conflict, not a server fault.
    if (err?.code === 'P2002') throwError('USERNAME_TAKEN');
    throw err;
  }
};

module.exports = { profile, me, updateMe, PUBLIC_PROFILE_SELECT };
