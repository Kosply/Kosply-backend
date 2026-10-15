/**
 * @title Support service (tickets + chat + internal notes)
 * @notice Users open tickets; admins reply; `isInternal` notes stay admin-only.
 * @dev Display numbers (`KSP-…`) are generated with collision retries.
 */
const crypto = require('node:crypto');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const { attachChildren } = require('../../../db/src/repo/relations');
const { isStaff } = require('../../middlewares/auth/auth');
const { toText, assertSafeUrl, MAX_MESSAGE_LENGTH } = require('../shared/validators');

const CATEGORIES = ['AKUN', 'PRODUK', 'CHAT', 'VERIFIKASI', 'LAPORAN', 'LAINNYA'];

const ticketNo = () => {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `KSP-${day}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
};

/**
 * @notice Open a ticket for the caller.
 * @param {object} input Body `{ category?, subject, description }`.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} Created ticket.
 */
const open = async (input = {}, actor) => {
  const db = requireDb();
  const category = String(input.category || 'LAINNYA').toUpperCase();
  if (!CATEGORIES.includes(category)) throwError('VALIDATION', { details: 'unknown category' });
  const subject = String(input.subject || '').trim();
  const description = String(input.description || '').trim();
  if (!subject || !description) throwError('VALIDATION', { details: 'subject and description are required' });
  // `ticketNo` carries two random hex digits against a unique column, so a
  // collision is rare; three attempts bounds the retry and then rethrows.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.insert('support_tickets', {
        ticketNo: ticketNo(),
        userId: actor.id,
        category,
        subject,
        description,
      });
    } catch (err) {
      if (err?.code !== 'DB_DUPLICATE' || attempt === 2) throw err;
    }
  }
  throwError('VALIDATION', { details: 'could not number the ticket, retry' });
};

/** @dev Bound the read so one request cannot hydrate an unbounded thread. */
const MAX_TICKET_MESSAGES = 200;
const MAX_TICKETS_PER_QUERY = 100;

/** @dev The ticket thread, oldest first, capped per ticket. */
const MESSAGES = {
  key: 'ticketId',
  targetTable: 'support_messages',
  on: 'messages',
};

/**
 * @notice Load one ticket with messages (internal notes filtered for non-admins).
 * @param {string} id Ticket id.
 * @param {object} actor Authenticated user `{ id, role }`.
 * @return {Promise<object>} Ticket or throws `TICKET_NOT_FOUND`.
 */
const get = async (id, actor) => {
  const db = requireDb();
  const staff = isStaff(actor.role);
  const ticket = await db.selectOne('support_tickets', {
    where: staff ? { id } : { id, userId: actor.id },
  });
  if (!ticket) throwError('TICKET_NOT_FOUND');
  const [hydrated] = await attachChildren([ticket], MESSAGES, {
    limit: MAX_TICKET_MESSAGES,
    orderBy: 'createdAt',
  });
  if (!staff) {
    // The thread is fetched whole and filtered here rather than in SQL. Internal
    // notes are few, and filtering after the read keeps one query shape for both
    // roles — but the filter must happen before the value leaves this function,
    // since these rows are admin-only by definition.
    hydrated.messages = hydrated.messages.filter((m) => !m.isInternal);
  }
  return hydrated;
};

/**
 * @notice List tickets (own scope, or all for ADMIN with filters).
 * @param {object} query Query `{ status?, category? }` (admin only filters).
 * @param {object} actor Authenticated user `{ id, role }`.
 * @return {Promise<Array>} Newest first.
 */
const list = async (query = {}, actor) => {
  const db = requireDb();
  const where = isStaff(actor.role) ? {} : { userId: actor.id };
  if (isStaff(actor.role)) {
    if (['ACTIVE', 'CLOSED'].includes(query.status)) where.status = query.status;
    if (CATEGORIES.includes(String(query.category || '').toUpperCase())) {
      where.category = String(query.category).toUpperCase();
    }
  }
  return db.selectMany('support_tickets', {
    where,
    orderBy: { updatedAt: 'desc' },
    limit: MAX_TICKETS_PER_QUERY,
  });
};

/**
 * @notice Reply in a ticket; `isInternal` only sticks for admins.
 * @param {string} id Ticket id.
 * @param {object} input Body `{ text, imageUrl?, isInternal? }`.
 * @param {object} actor Authenticated user `{ id, role }`.
 * @return {Promise<object>} Created message.
 */
const reply = async (id, input = {}, actor) => {
  const db = requireDb();
  const staff = isStaff(actor.role);
  const ticket = await db.selectOne('support_tickets', {
    where: staff ? { id } : { id, userId: actor.id },
    columns: ['id', 'userId', 'status'],
  });
  if (!ticket) throwError('TICKET_NOT_FOUND');
  // A CLOSED ticket used to accept replies: the message was stored and
  // `lastMessageAt` bumped while `status` stayed CLOSED, so the follow-up was
  // invisible in the `status=ACTIVE` triage view forever.
  if (ticket.status === 'CLOSED') throwError('TICKET_CLOSED');
  const text = toText(input.text, 'text', { min: 1, max: MAX_MESSAGE_LENGTH });
  // The message and the ticket's `lastMessageAt` must land together: a stored
  // reply with a stale `lastMessageAt` hides the ticket from the triage list
  // ordered by activity.
  const message = await db.transaction(async () => {
    const created = await db.insert('support_messages', {
      ticketId: id,
      // A dashboard operator has no `users` row: the sender is attributed by
      // role + name snapshot instead (see schema.SupportMessage.senderId).
      senderId: actor.isDashboard ? null : actor.id,
      senderRole: actor.role,
      senderName: actor.isDashboard ? actor.email || null : null,
      text,
      imageUrl: input.imageUrl ? assertSafeUrl(input.imageUrl, 'imageUrl') : null,
      isInternal: staff && input.isInternal === true,
    });
    await db.update('support_tickets', { lastMessageAt: new Date() }, { where: { id } });
    return created;
  });
  if (staff && !message.isInternal) {
    const { notify } = require('../notifications/notification.service');
    await notify(ticket.userId, 'support', 'Balasan support', text, { ticketId: id });
  }
  return message;
};

/**
 * @notice Close a ticket (owner or ADMIN).
 * @param {string} id Ticket id.
 * @param {object} actor Authenticated user `{ id, role }`.
 * @return {Promise<object>} Closed ticket.
 */
const close = async (id, actor) => {
  const db = requireDb();
  const ticket = await db.selectOne('support_tickets', {
    where: isStaff(actor.role) ? { id } : { id, userId: actor.id },
    columns: ['id'],
  });
  if (!ticket) throwError('TICKET_NOT_FOUND');
  return db.update('support_tickets', { status: 'CLOSED' }, { where: { id } });
};

module.exports = { open, get, list, reply, close };
