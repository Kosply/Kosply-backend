/**
 * @title Support service (tickets + chat + internal notes)
 * @notice Users open tickets; admins reply; `isInternal` notes stay admin-only.
 * @dev Display numbers (`KSP-…`) are generated with collision retries.
 */
const crypto = require('node:crypto');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
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
  const prisma = requireDb();
  const category = String(input.category || 'LAINNYA').toUpperCase();
  if (!CATEGORIES.includes(category)) throwError('VALIDATION', { details: 'unknown category' });
  const subject = String(input.subject || '').trim();
  const description = String(input.description || '').trim();
  if (!subject || !description) throwError('VALIDATION', { details: 'subject and description are required' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.supportTicket.create({
        data: { ticketNo: ticketNo(), userId: actor.id, category, subject, description },
      });
    } catch (err) {
      if (err?.code !== 'P2002' || attempt === 2) throw err;
    }
  }
  throwError('VALIDATION', { details: 'could not number the ticket, retry' });
};

/** @dev Bound the read so one request cannot hydrate an unbounded thread. */
const MAX_TICKET_MESSAGES = 200;
const MAX_TICKETS_PER_QUERY = 100;

/**
 * @notice Load one ticket with messages (internal notes filtered for non-admins).
 * @param {string} id Ticket id.
 * @param {object} actor Authenticated user `{ id, role }`.
 * @return {Promise<object>} Ticket or throws `TICKET_NOT_FOUND`.
 */
const get = async (id, actor) => {
  const prisma = requireDb();
  const ticket = await prisma.supportTicket.findFirst({
    where: isStaff(actor.role) ? { id } : { id, userId: actor.id },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: MAX_TICKET_MESSAGES } },
  });
  if (!ticket) throwError('TICKET_NOT_FOUND');
  if (!isStaff(actor.role)) {
    ticket.messages = ticket.messages.filter((m) => !m.isInternal);
  }
  return ticket;
};

/**
 * @notice List tickets (own scope, or all for ADMIN with filters).
 * @param {object} query Query `{ status?, category? }` (admin only filters).
 * @param {object} actor Authenticated user `{ id, role }`.
 * @return {Promise<Array>} Newest first.
 */
const list = async (query = {}, actor) => {
  const prisma = requireDb();
  const where = isStaff(actor.role) ? {} : { userId: actor.id };
  if (isStaff(actor.role)) {
    if (['ACTIVE', 'CLOSED'].includes(query.status)) where.status = query.status;
    if (CATEGORIES.includes(String(query.category || '').toUpperCase())) {
      where.category = String(query.category).toUpperCase();
    }
  }
  return prisma.supportTicket.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: MAX_TICKETS_PER_QUERY,
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
  const prisma = requireDb();
  const staff = isStaff(actor.role);
  const ticket = await prisma.supportTicket.findFirst({
    where: staff ? { id } : { id, userId: actor.id },
    select: { id: true, userId: true, status: true },
  });
  if (!ticket) throwError('TICKET_NOT_FOUND');
  // A CLOSED ticket used to accept replies: the message was stored and
  // `lastMessageAt` bumped while `status` stayed CLOSED, so the follow-up was
  // invisible in the `status=ACTIVE` triage view forever.
  if (ticket.status === 'CLOSED') throwError('TICKET_CLOSED');
  const text = toText(input.text, 'text', { min: 1, max: MAX_MESSAGE_LENGTH });
  const [message] = await prisma.$transaction([
    prisma.supportMessage.create({
      data: {
        ticketId: id,
        // A dashboard operator has no `users` row: the sender is attributed by
        // role + name snapshot instead (see schema.SupportMessage.senderId).
        senderId: actor.isDashboard ? null : actor.id,
        senderRole: actor.role,
        senderName: actor.isDashboard ? actor.email || null : null,
        text,
        imageUrl: input.imageUrl ? assertSafeUrl(input.imageUrl, 'imageUrl') : null,
        isInternal: staff && input.isInternal === true,
      },
    }),
    prisma.supportTicket.update({ where: { id }, data: { lastMessageAt: new Date() } }),
  ]);
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
  const prisma = requireDb();
  const ticket = await prisma.supportTicket.findFirst({
    where: isStaff(actor.role) ? { id } : { id, userId: actor.id },
    select: { id: true },
  });
  if (!ticket) throwError('TICKET_NOT_FOUND');
  return prisma.supportTicket.update({ where: { id }, data: { status: 'CLOSED' } });
};

module.exports = { open, get, list, reply, close };
