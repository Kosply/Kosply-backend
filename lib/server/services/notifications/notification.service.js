/**
 * @title Notification service (personal inbox + free toggles)
 * @notice Opt-out model: every key is enabled unless the user disables it.
 * @dev Users freely enable/disable each key; emission checks before writing
 * @dev so disabled kinds never even hit the table.
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

/** @dev Rows per page. */
const PAGE_SIZE = 100;

/**
 * @notice Parse a `<iso-timestamp>|<id>` pagination cursor.
 * @dev Malformed input is a 400, not a 500 and not a silently ignored page.
 * @param {unknown} raw Query value.
 * @return {{createdAt: Date, id: string}|null} The cursor, or null.
 */
const parseBeforeCursor = (raw) => {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = String(raw);
  const [stamp, id] = value.split('|');
  if (!stamp || !id || !/^\d{4}-\d{2}-\d{2}T/.test(stamp) || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throwError('VALIDATION', { details: 'before must be "<iso-timestamp>|<id>"' });
  }
  const createdAt = new Date(stamp);
  if (Number.isNaN(createdAt.getTime())) {
    throwError('VALIDATION', { details: 'before timestamp is not a valid date' });
  }
  return { createdAt, id };
};

const KEYS = ['chat', 'verification', 'reports', 'support', 'product', 'system'];

/**
 * @notice Check one toggle (missing row = enabled).
 * @param {string} userId Owner id.
 * @param {string} key Event group.
 * @param {object} [prisma] Optional client (reuse inside transactions).
 * @return {Promise<boolean>} True when deliverable.
 */
const isEnabled = async (userId, key, prisma = null) => {
  const db = prisma || requireDb();
  const row = await db.notificationPreference.findUnique({
    where: { userId_key: { userId, key } },
    select: { enabled: true },
  });
  return row ? row.enabled : true;
};

/**
 * @notice Emit a notification when the key is enabled for the user.
 * @param {string} userId Recipient id.
 * @param {string} key Event group (validated).
 * @param {string} title Short title.
 * @param {string} body Longer text.
 * @param {object} [data] Deep-link payload.
 * @return {Promise<object|null>} Created row, or null when disabled.
 */
const notify = async (userId, key, title, body, data = null) => {
  if (!KEYS.includes(key)) throwError('VALIDATION', { details: 'unknown notification key' });
  const prisma = requireDb();
  if (!(await isEnabled(userId, key, prisma))) return null;
  return prisma.notification.create({ data: { userId, type: key, title, body, data: data || undefined } });
};

/**
 * @notice List the caller's notifications, newest first.
 * @param {object} query Query `{ unreadOnly? }`.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<Array>} Notification rows.
 */
const list = async (query = {}, actor) => {
  const prisma = requireDb();
  // A bare `take: 100` with no cursor made older unread rows permanently
  // unreachable: the badge could never reconcile, and they could not be read or
  // individually marked. `before` pages backwards using a `(createdAt, id)`
  // pair.
  //
  // The cursor MUST be built by hand. Prisma's `cursor:` only accepts a unique
  // field, and `createdAt` is not unique, so `cursor: { createdAt }` raised a
  // PrismaClientValidationError -> 500 for *every* paged request.
  const where = {
    userId: actor.id,
    ...(String(query.unreadOnly).toLowerCase() === 'true' && { isRead: false }),
  };
  const before = parseBeforeCursor(query.before);
  if (before) {
    where.OR = [
      { createdAt: { lt: before.createdAt } },
      { createdAt: before.createdAt, id: { lt: before.id } },
    ];
  }
  return prisma.notification.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE,
  });
};

/**
 * @notice Mark one notification read (owner only).
 * @param {string} id Notification id.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} Updated row.
 */
const markRead = async (id, actor) => {
  const prisma = requireDb();
  const row = await prisma.notification.findFirst({ where: { id, userId: actor.id } });
  if (!row) throwError('VALIDATION', { details: 'notification not found' });
  return prisma.notification.update({
    where: { id },
    data: { isRead: true, readAt: new Date() },
  });
};

/**
 * @notice Mark all own notifications read.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} `{ status: 'ok', count }`.
 */
const markAllRead = async (actor) => {
  const prisma = requireDb();
  const { count } = await prisma.notification.updateMany({
    where: { userId: actor.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return { status: 'ok', count };
};

/**
 * @notice Read all toggles with current values (defaults true).
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<Array>} `{ key, enabled }` per known key.
 */
const preferences = async (actor) => {
  const prisma = requireDb();
  const rows = await prisma.notificationPreference.findMany({ where: { userId: actor.id } });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
  return KEYS.map((key) => ({ key, enabled: byKey[key] !== undefined ? byKey[key] : true }));
};

/**
 * @notice Freely enable/disable one toggle (upsert).
 * @param {object} input Body `{ key, enabled }`.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} `{ key, enabled }`.
 */
const setPreference = async (input = {}, actor) => {
  const prisma = requireDb();
  const key = String(input.key || '');
  if (!KEYS.includes(key)) throwError('VALIDATION', { details: 'unknown notification key' });
  // `input.enabled !== false` treated 0, "false", null and "" as *enabled*, so a
  // loosely-typed client sending `{"enabled": 0}` silently kept the toggle on
  // while the user believed notifications were off.
  if (typeof input.enabled !== 'boolean') {
    throwError('VALIDATION', { details: 'enabled must be a boolean' });
  }
  const row = await prisma.notificationPreference.upsert({
    where: { userId_key: { userId: actor.id, key } },
    update: { enabled: input.enabled },
    create: { userId: actor.id, key, enabled: input.enabled },
  });
  return { key: row.key, enabled: row.enabled };
};

module.exports = { KEYS, isEnabled, notify, list, markRead, markAllRead, preferences, setPreference };
