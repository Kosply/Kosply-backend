/**
 * @title AI model service (registry for the Flutter selector)
 * @notice Public list shows active models only; admin manages the registry.
 * @dev Deleting a model referenced by chat history is refused (disable instead).
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

/**
 * @notice Validate model fields (shared by create and patch).
 * @param {object} input Raw body fields.
 * @param {boolean} partial True for PATCH (all fields optional).
 * @return {object} Normalized writable fields.
 */
const validateModel = (input = {}, partial = false) => {
  const out = {};
  if (input.modelId !== undefined || !partial) {
    const modelId = String(input.modelId || '').trim();
    if (!modelId) throwError('VALIDATION', { details: 'modelId is required' });
    out.modelId = modelId;
  }
  if (input.name !== undefined || !partial) {
    const name = String(input.name || '').trim();
    if (!name) throwError('VALIDATION', { details: 'name is required' });
    out.name = name;
  }
  for (const key of ['inputPrice', 'outputPrice', 'cacheReadPrice']) {
    if (input[key] !== undefined) {
      const value = Number(input[key]);
      if (!Number.isFinite(value) || value < 0) {
        throwError('VALIDATION', { details: `${key} must be a number >= 0` });
      }
      out[key] = value;
    } else if (!partial && key !== 'cacheReadPrice') {
      throwError('VALIDATION', { details: `${key} is required` });
    }
  }
  if (input.isActive !== undefined) out.isActive = input.isActive === true;
  return out;
};

/**
 * @notice List active models for the Flutter selector.
 * @return {Promise<Array>} Active models with pricing.
 */
const listActive = async () => {
  const prisma = requireDb();
  return prisma.aiModel.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });
};

/**
 * @notice Register a model (ADMIN).
 * @param {object} input Body fields.
 * @return {Promise<object>} Created model.
 */
const create = async (input) => {
  const prisma = requireDb();
  try {
    return await prisma.aiModel.create({ data: validateModel(input) });
  } catch (err) {
    if (err?.code === 'P2002') throwError('MODEL_EXISTS');
    throw err;
  }
};

/**
 * @notice Update a model: pricing, name, or enable/disable (ADMIN).
 * @param {string} id Model id.
 * @param {object} input Partial body fields.
 * @return {Promise<object>} Updated model.
 */
const update = async (id, input) => {
  const prisma = requireDb();
  const existing = await prisma.aiModel.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throwError('MODEL_NOT_FOUND');
  try {
    return await prisma.aiModel.update({ where: { id }, data: validateModel(input, true) });
  } catch (err) {
    if (err?.code === 'P2002') throwError('MODEL_EXISTS');
    throw err;
  }
};

/**
 * @notice Delete a model (ADMIN). Refused when chat history references it.
 * @param {string} id Model id.
 * @return {Promise<void>} Resolves on delete.
 */
const remove = async (id) => {
  const prisma = requireDb();
  const existing = await prisma.aiModel.findUnique({ where: { id } });
  if (!existing) throwError('MODEL_NOT_FOUND');
  const used = await prisma.aiMessage.count({ where: { model: existing.modelId } });
  if (used > 0) throwError('MODEL_IN_USE');
  await prisma.aiModel.delete({ where: { id } });
};

module.exports = { validateModel, listActive, create, update, remove };
