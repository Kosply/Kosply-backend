/**
 * @title Report service (fraud intake + admin enforcement)
 * @notice Users file reports; admins act: warn, archive the listing, or freeze the seller.
 * @dev `NONE` action dismisses the report (`REJECTED`); any real action resolves it.
 */
const crypto = require('node:crypto');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const { assertSafeUrl } = require('../shared/validators');

const CATEGORIES = [
  'PENIPUAN',
  'BARANG_PALSU',
  'BARANG_TIDAK_SESUAI',
  'HARGA_MENYESATKAN',
  'KONTEN_TIDAK_PANTAS',
  'SPAM',
  'LAINNYA',
];
const ACTIONS = ['NONE', 'WARNING', 'DELETE_PRODUCT', 'BAN_USER'];

/** @dev Bound the admin list; it was an unbounded `findMany` over the whole table. */
const MAX_LIST_ROWS = 100;

const reportNo = () => {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `RPT-${day}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
};

/**
 * @notice File a report (at least one target required).
 * @param {object} input Body `{ reportedUserId?, reportedProductId?, category?, description, evidenceUrls? }`.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} Created report.
 */
const file = async (input = {}, actor) => {
  const prisma = requireDb();
  const reportedUserId =
    typeof input.reportedUserId === 'string' && input.reportedUserId.trim()
      ? input.reportedUserId.trim()
      : null;
  const reportedProductId =
    typeof input.reportedProductId === 'string' && input.reportedProductId.trim()
      ? input.reportedProductId.trim()
      : null;
  if (!reportedUserId && !reportedProductId) {
    throwError('VALIDATION', { details: 'reportedUserId or reportedProductId is required' });
  }
  const category = String(input.category || 'LAINNYA').toUpperCase();
  if (!CATEGORIES.includes(category)) throwError('VALIDATION', { details: 'unknown category' });
  const description = String(input.description || '').trim();
  if (!description) throwError('VALIDATION', { details: 'description is required' });
  if (input.description.length > 5000) throwError('VALIDATION', { details: 'description is too long' });
  if (reportedUserId && reportedUserId === actor.id) {
    throwError('VALIDATION', { details: 'cannot report yourself' });
  }
  if (Array.isArray(input.evidenceUrls) && input.evidenceUrls.length > 8) {
    throwError('VALIDATION', { details: 'at most 8 evidence urls are allowed' });
  }
  const evidenceUrls = Array.isArray(input.evidenceUrls)
    ? input.evidenceUrls.map((url) => assertSafeUrl(url, 'evidenceUrls'))
    : [];
  // Existence was never checked: a stale id produced a `P2003` foreign-key
  // violation, surfacing as a 500 with the driver message instead of a 404.
  const [user, product] = await Promise.all([
    reportedUserId
      ? prisma.user.findUnique({ where: { id: reportedUserId }, select: { id: true, role: true } })
      : null,
    reportedProductId
      ? prisma.product.findUnique({ where: { id: reportedProductId }, select: { id: true } })
      : null,
  ]);
  if (reportedUserId && !user) throwError('USER_NOT_FOUND');
  if (reportedUserId && ['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throwError('VALIDATION', { details: 'staff accounts cannot be reported here' });
  }
  if (reportedProductId && !product) throwError('PRODUCT_NOT_FOUND');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.report.create({
        data: {
          reportNo: reportNo(),
          reporterId: actor.id,
          reportedUserId,
          reportedProductId,
          category,
          description,
          evidenceUrls,
        },
      });
    } catch (err) {
      if (err?.code !== 'P2002' || attempt === 2) throw err;
    }
  }
  throwError('VALIDATION', { details: 'could not number the report, retry' });
};

/**
 * @notice List reports for the admin dashboard (filterable).
 * @param {object} query Query `{ status?, category? }`.
 * @return {Promise<Array>} Newest first.
 */
const list = async (query = {}) => {
  const prisma = requireDb();
  const where = {};
  if (['PENDING', 'IN_REVIEW', 'RESOLVED', 'REJECTED'].includes(query.status)) where.status = query.status;
  if (CATEGORIES.includes(String(query.category || '').toUpperCase())) {
    where.category = String(query.category).toUpperCase();
  }
  return prisma.report.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: MAX_LIST_ROWS,
  });
};

/**
 * @notice Review a report and execute the action.
 * @dev WARNING records only — it must never change account state. An earlier
 * @dev version reactivated the reported user here, which silently undid a
 * @dev previous BAN_USER and, with DB-backed auth, revived live sessions.
 * @dev One transaction: the three writes previously ran in sequence, so a
 * @dev failure after the enforcement step left the listing archived (or the
 * @dev seller frozen) while the report stayed `PENDING` and the admin — seeing
 * @dev a 500 — clicked again, double-applying the enforcement.
 * @dev Refuses an already-decided report: `review` used to be replayable, which
 * @dev let a second admin re-fire BAN_USER and overwrite the first reviewer's
 * @dev id, action and note, destroying the audit record.
 * @param {string} id Report id.
 * @param {object} input Body `{ action, actionNote? }`.
 * @param {object} admin Acting admin `{ id, isDashboard? }`.
 * @return {Promise<object>} Updated report.
 */
const review = async (id, input = {}, admin) => {
  const prisma = requireDb();
  const action = String(input.action || '').toUpperCase();
  if (!ACTIONS.includes(action)) throwError('VALIDATION', { details: 'unknown action' });
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) throwError('REPORT_NOT_FOUND');
  if (report.status !== 'PENDING') {
    throwError('REPORT_DECIDED', { details: 'this report has already been decided' });
  }
  // A dashboard operator has no `users` row; `reviewedBy` is an opaque audit
  // field, so store null rather than an id that satisfies no FK.
  const reviewedBy = admin.isDashboard ? null : admin.id;
  const decided = await prisma.$transaction(async (tx) => {
    if (action === 'DELETE_PRODUCT' && report.reportedProductId) {
      await tx.product.update({
        where: { id: report.reportedProductId },
        data: { status: 'ARCHIVED' },
      });
    }
    if (action === 'BAN_USER' && report.reportedUserId) {
      await tx.sellerVerification.updateMany({
        where: { userId: report.reportedUserId },
        data: { isActive: false },
      });
      // Also block the account: `isActive` on the verification was written but
      // read by nothing, so a banned seller kept creating and editing listings.
      // Never demote or disable a staff account: the moderation panel could
      // otherwise lock itself out with one click.
      await tx.user.updateMany({
        where: { id: report.reportedUserId, role: { notIn: ['ADMIN', 'SUPER_ADMIN'] } },
        data: { isActive: false, role: 'BUYER' },
      });
    }
    return tx.report.update({
      where: { id },
      data: {
        status: action === 'NONE' ? 'REJECTED' : 'RESOLVED',
        action,
        actionNote: input.actionNote ? String(input.actionNote) : null,
        reviewedBy,
        reviewedAt: new Date(),
      },
    });
  });
  const { notify } = require('../notifications/notification.service');
  await notify(
    report.reporterId,
    'reports',
    action === 'NONE' ? 'Laporan ditolak' : `Laporan diproses: ${action}`,
    input.actionNote ? String(input.actionNote) : 'Terima kasih atas laporanmu.',
    { reportId: report.id }
  );
  return decided;
};

module.exports = { file, list, review };
