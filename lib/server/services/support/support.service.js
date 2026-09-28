/**
 * @title Support service (tickets + chat + internal notes)
 * @notice Users open tickets; admins reply; `isInternal` notes stay admin-only.
 * @dev Display numbers (`KSP-…`) are generated with collision retries.
 */
const crypto = require('node:crypto');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

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

/**
 * @notice Load one ticket with messages (internal notes filtered for non-admins).
 * @param {string} id Ticket id.
 * @param {object} actor Authenticated user `{ id, role }`.
 * @return {Promise<object>} Ticket or throws `TICKET_NOT_FOUND`.
 */
const get = async (id, actor) => {
  const prisma = requireDb();
  const ticket = await prisma.supportTicket.findFirst({
    where: actor.role === 'ADMIN' ? { id } : { id, userId: actor.id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!ticket) throwError('TICKET_NOT_FOUND');
  if (actor.role !== 'ADMIN') {
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
  const where = actor.role === 'ADMIN' ? {} : { userId: actor.id };
  if (actor.role === 'ADMIN') {
    if (['ACTIVE', 'CLOSED'].includes(query.status)) where.status = query.status;
    if (CATEGORIES.includes(String(query.category || '').toUpperCase())) {
      where.category = String(query.category).toUpperCase();
    }
  }
  return prisma.supportTicket.findMany({ where, orderBy: { updatedAt: 'desc' } });
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
  const ticket = await prisma.supportTicket.findFirst({
    where: actor.role === 'ADMIN' ? { id } : { id, userId: actor.id },
    select: { id: true },
  });
  if (!ticket) throwError('TICKET_NOT_FOUND');
  const text = String(input.text || '').trim();
  if (!text) throwError('VALIDATION', { details: 'text is required' });
  const [message] = await prisma.$transaction([
    prisma.supportMessage.create({
      data: {
        ticketId: id,
        senderId: actor.id,
        text,
        imageUrl: input.imageUrl ? String(input.imageUrl) : null,
        isInternal: actor.role === 'ADMIN' && input.isInternal === true,
      },
    }),
    prisma.supportTicket.update({ where: { id }, data: { lastMessageAt: new Date() } }),
  ]);
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
    where: actor.role === 'ADMIN' ? { id } : { id, userId: actor.id },
    select: { id: true },
  });
  if (!ticket) throwError('TICKET_NOT_FOUND');
  return prisma.supportTicket.update({ where: { id }, data: { status: 'CLOSED' } });
};

module.exports = { open, get, list, reply, close };
