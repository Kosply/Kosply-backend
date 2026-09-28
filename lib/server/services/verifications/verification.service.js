/**
 * @title Verification service (KTM submit + admin review)
 * @notice Students apply once; admins approve (promotes to SELLER) or reject.
 * @dev Rejected applicants may resubmit (updates the same row); PENDING or
 * @dev APPROVED rows block duplicates with VERIFICATION_EXISTS.
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

/**
 * @notice Validate a verification application.
 * @param {object} input Raw body fields.
 * @return {object} Normalized fields.
 */
const validateApplication = (input = {}) => {
  const namaLengkap = String(input.namaLengkap || '').trim();
  const nim = String(input.nim || '').trim();
  const universitas = String(input.universitas || '').trim();
  const programStudi = String(input.programStudi || '').trim();
  const ktmImageUrl = String(input.ktmImageUrl || '').trim();
  const problems = [];
  if (!namaLengkap) problems.push('namaLengkap is required');
  if (!nim) problems.push('nim is required');
  if (!universitas) problems.push('universitas is required');
  if (!programStudi) problems.push('programStudi is required');
  if (!ktmImageUrl) problems.push('ktmImageUrl is required');
  if (problems.length) throwError('VALIDATION', { details: problems });
  return { namaLengkap, nim, universitas, programStudi, ktmImageUrl };
};

/**
 * @notice Submit (or resubmit after rejection) the caller's application.
 * @param {object} input Raw body fields.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} The verification row (KTM URL included: owner/admin only route).
 */
const submit = async (input, actor) => {
  const prisma = requireDb();
  const data = validateApplication(input);
  const existing = await prisma.sellerVerification.findUnique({ where: { userId: actor.id } });
  if (existing && existing.status !== 'REJECTED') throwError('VERIFICATION_EXISTS');
  if (existing) {
    return prisma.sellerVerification.update({
      where: { userId: actor.id },
      data: { ...data, status: 'PENDING', isActive: true, action: 'NONE', actionNote: null, rejectionReason: null, reviewedBy: null, reviewedAt: null },
    });
  }
  try {
    return await prisma.sellerVerification.create({ data: { ...data, userId: actor.id } });
  } catch (err) {
    if (err?.code === 'P2002') throwError('VALIDATION', { details: 'nim already registered' });
    throw err;
  }
};

/**
 * @notice Read the caller's own application (or null).
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object|null>} Verification row or null.
 */
const mine = async (actor) => {
  const prisma = requireDb();
  return prisma.sellerVerification.findUnique({ where: { userId: actor.id } });
};

/**
 * @notice List applications for the admin dashboard (filterable by status).
 * @param {object} query Query `{ status? }`.
 * @return {Promise<Array>} Newest first.
 */
const list = async (query = {}) => {
  const prisma = requireDb();
  const where = {};
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(query.status)) where.status = query.status;
  return prisma.sellerVerification.findMany({
    where,
    include: { user: { select: { username: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * @notice Review one application: APPROVE promotes to SELLER, REJECT needs a reason.
 * @param {string} id Verification id.
 * @param {object} input Body `{ action: APPROVE|REJECT, actionNote?, rejectionReason? }`.
 * @param {object} admin Acting admin `{ id }` (users.role ADMIN).
 * @return {Promise<object>} Updated row.
 */
const review = async (id, input = {}, admin) => {
  const prisma = requireDb();
  const action = String(input.action || '').toUpperCase();
  if (!['APPROVE', 'REJECT'].includes(action)) {
    throwError('VALIDATION', { details: 'action must be APPROVE or REJECT' });
  }
  if (action === 'REJECT' && !String(input.rejectionReason || '').trim()) {
    throwError('VALIDATION', { details: 'rejectionReason is required' });
  }
  const existing = await prisma.sellerVerification.findUnique({ where: { id } });
  if (!existing) throwError('VALIDATION', { details: 'verification not found' });
  const row = await prisma.sellerVerification.update({
    where: { id },
    data: {
      status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      isActive: action === 'APPROVE',
      action,
      actionNote: input.actionNote ? String(input.actionNote) : null,
      rejectionReason: action === 'REJECT' ? String(input.rejectionReason).trim() : null,
      reviewedBy: admin.id,
      reviewedAt: new Date(),
    },
  });
  if (action === 'APPROVE') {
    await prisma.user.update({ where: { id: row.userId }, data: { role: 'SELLER' } });
  }
  return row;
};

module.exports = { validateApplication, submit, mine, list, review };
