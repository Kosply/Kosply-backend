/**
 * @title Report service (fraud intake + admin enforcement)
 * @notice Users file reports; admins act: warn, archive the listing, or freeze the seller.
 * @dev `NONE` action dismisses the report (`REJECTED`); any real action resolves it.
 */
const crypto = require('node:crypto');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

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
  const evidenceUrls = Array.isArray(input.evidenceUrls) ? input.evidenceUrls.map(String) : [];
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
  return prisma.report.findMany({ where, orderBy: { createdAt: 'desc' } });
};

/**
 * @notice Review a report and execute the action.
 * @dev WARNING records only; DELETE_PRODUCT archives the listing;
 * @dev BAN_USER freezes the seller verification (`isActive=false`).
 * @param {string} id Report id.
 * @param {object} input Body `{ action, actionNote? }`.
 * @param {object} admin Acting admin `{ id }` (users.role ADMIN).
 * @return {Promise<object>} Updated report.
 */
const review = async (id, input = {}, admin) => {
  const prisma = requireDb();
  const action = String(input.action || '').toUpperCase();
  if (!ACTIONS.includes(action)) throwError('VALIDATION', { details: 'unknown action' });
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) throwError('REPORT_NOT_FOUND');
  if (action === 'DELETE_PRODUCT' && report.reportedProductId) {
    await prisma.product.update({
      where: { id: report.reportedProductId },
      data: { status: 'ARCHIVED' },
    });
  }
  if (action === 'BAN_USER' && report.reportedUserId) {
    await prisma.sellerVerification.updateMany({
      where: { userId: report.reportedUserId },
      data: { isActive: false },
    });
  }
  return prisma.report.update({
    where: { id },
    data: {
      status: action === 'NONE' ? 'REJECTED' : 'RESOLVED',
      action,
      actionNote: input.actionNote ? String(input.actionNote) : null,
      reviewedBy: admin.id,
      reviewedAt: new Date(),
    },
  });
};

module.exports = { file, list, review };
