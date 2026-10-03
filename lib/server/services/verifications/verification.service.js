/**
 * @title Verification service (KTM submit + admin review)
 * @notice Students apply once; admins approve (promotes to SELLER) or reject.
 * @dev Rejected applicants may resubmit (updates the same row); PENDING or
 * @dev APPROVED rows block duplicates with VERIFICATION_EXISTS.
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const { toText, assertSafeUrl } = require('../shared/validators');

/** @dev Bound the admin list so one request cannot hydrate the whole table. */
const MAX_LIST_ROWS = 100;

/**
 * @notice Validate a verification application.
 * @param {object} input Raw body fields.
 * @return {object} Normalized fields.
 */
const validateApplication = (input = {}) => {
  // `String(null)` is the literal "null"; every field below is NOT NULL, so a
  // null became the string "null" instead of a validation error. Types are
  // checked and lengths bounded, and the KTM URL is scheme-restricted: it is
  // rendered as a link in the admin dashboard, so `javascript:` here is a
  // click-to-execute payload against a moderator.
  const namaLengkap = toText(input.namaLengkap, 'namaLengkap', { min: 1, max: 120 });
  const nim = toText(input.nim, 'nim', { min: 4, max: 32 });
  const universitas = toText(input.universitas, 'universitas', { min: 1, max: 120 });
  const programStudi = toText(input.programStudi, 'programStudi', { min: 1, max: 120 });
  const ktmImageUrl = assertSafeUrl(input.ktmImageUrl, 'ktmImageUrl', { maxLength: 1024 });
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
  try {
    if (existing) {
      return await prisma.sellerVerification.update({
        where: { userId: actor.id },
        // The admin's decision record is preserved in `lastDecision` (see
        // schema) instead of being nulled here. Wiping `reviewedBy`, `action`
        // and `rejectionReason` on resubmit destroyed the only audit trail of a
        // rejection, and the frozen user could also re-enable their own
        // `isActive` flag with a single POST.
        data: { ...data, status: 'PENDING', action: 'NONE', actionNote: null },
      });
    }
    return await prisma.sellerVerification.create({ data: { ...data, userId: actor.id } });
  } catch (err) {
    if (err?.code === 'P2002') {
      // Deliberately vague: "nim already registered" told any pre-registered
      // account whether a given student id was in the system (a student-id
      // existence oracle over the whole user body).
      throwError('VALIDATION', { details: 'application could not be accepted' });
    }
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
    // Ordered by updatedAt, not createdAt: a resubmitted application keeps its
    // original createdAt, so ordering by it ranked the freshest submission last
    // and hid it from the PENDING queue.
    orderBy: { updatedAt: 'desc' },
    take: MAX_LIST_ROWS,
  });
};

/**
 * @notice Review one application: APPROVE promotes to SELLER, REJECT needs a reason.
 * @dev One transaction: the verification row and the user role previously moved
 * @dev in two statements, so a failure between them left an APPROVED seller who
 * @dev could not sell and could not resubmit (`submit` blocks on
 * @dev `status !== 'REJECTED'`). REJECT now also demotes the role, and an
 * @dev already-decided application is refused instead of silently rewritten.
 * @param {string} id Verification id.
 * @param {object} input Body `{ action: APPROVE|REJECT, actionNote?, rejectionReason? }`.
 * @param {object} admin Acting admin `{ id, role, isDashboard? }`.
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
  if (!existing) throwError('VERIFICATION_NOT_FOUND');
  if (existing.status !== 'PENDING') {
    throwError('VERIFICATION_DECIDED', { details: 'this application has already been decided' });
  }
  // A dashboard operator has no `users` row, so the audit id is stored as an
  // opaque string (see schema.reviewedBy) instead of a users FK.
  const reviewedBy = admin.isDashboard ? null : admin.id;
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.sellerVerification.update({
      where: { id },
      data: {
        status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        isActive: action === 'APPROVE',
        action,
        actionNote: input.actionNote ? String(input.actionNote) : null,
        rejectionReason: action === 'REJECT' ? String(input.rejectionReason).trim() : null,
        reviewedBy,
        reviewedAt: new Date(),
      },
    });
    // Never demote a staff role: approving a verification belonging to an
    // ADMIN used to silently rewrite their role to SELLER.
    await tx.user.updateMany({
      where: { id: updated.userId, role: 'BUYER' },
      data: { role: action === 'APPROVE' ? 'SELLER' : 'BUYER' },
    });
    return updated;
  });
  const { notify } = require('../notifications/notification.service');
  await notify(
    row.userId,
    'verification',
    action === 'APPROVE' ? 'Verifikasi disetujui' : 'Verifikasi ditolak',
    action === 'APPROVE'
      ? 'Selamat! Akunmu sudah jadi SELLER, silakan pasang lapak.'
      : `Maaf: ${row.rejectionReason}`,
    { verificationId: row.id }
  );
  return row;
};

module.exports = { validateApplication, submit, mine, list, review };
