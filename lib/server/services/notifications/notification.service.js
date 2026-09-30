/**
 * @title Notification service (personal inbox + free toggles)
 * @notice Opt-out model: every key is enabled unless the user disables it.
 * @dev Users freely enable/disable each key; emission checks before writing
 * @dev so disabled kinds never even hit the table.
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

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
  return prisma.notification.findMany({
    where: {
      userId: actor.id,
      ...(String(query.unreadOnly).toLowerCase() === 'true' && { isRead: false }),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
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
  const row = await prisma.notificationPreference.upsert({
    where: { userId_key: { userId: actor.id, key } },
    update: { enabled: input.enabled !== false },
    create: { userId: actor.id, key, enabled: input.enabled !== false },
  });
  return { key: row.key, enabled: row.enabled };
};

module.exports = { KEYS, isEnabled, notify, list, markRead, markAllRead, preferences, setPreference };
