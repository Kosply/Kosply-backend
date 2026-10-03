/**
 * @title AI model service (registry for the Flutter selector)
 * @notice Public list shows active models only; admin manages the registry.
 * @dev Deleting a model referenced by chat history is refused (disable instead).
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const { toText, toNumber } = require('../shared/validators');

/** @dev Sane ceiling for USD per 1M tokens. */
const MAX_TOKEN_PRICE_USD = 1000;

/** @dev Bound the model registry read. */
const MAX_LIST_ROWS = 200;

/**
 * @notice Validate model fields (shared by create and patch).
 * @param {object} input Raw body fields.
 * @param {boolean} partial True for PATCH (all fields optional).
 * @return {object} Normalized writable fields.
 */
const validateModel = (input = {}, partial = false) => {
  const out = {};
  if (input.modelId !== undefined || !partial) {
    out.modelId = toText(input.modelId, 'modelId', { min: 1, max: 64 });
  }
  if (input.name !== undefined || !partial) {
    out.name = toText(input.name, 'name', { min: 1, max: 120 });
  }
  for (const key of ['inputPrice', 'outputPrice', 'cacheReadPrice']) {
    if (input[key] !== undefined) {
      // Bounded. These columns are money (USD per 1M tokens) and the previous
      // check accepted 1e-300, 1e30 and 17 significant digits, which then made
      // any cost rollup drift.
      out[key] = toNumber(input[key], key, { min: 0, max: MAX_TOKEN_PRICE_USD });
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
    take: MAX_LIST_ROWS,
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
  // `ai_messages.model` holds whatever the agent recorded for its configured
  // model, which is provider-prefixed (`AI_MODEL="openai:gpt-4o-mini"`), so it
  // never equals a registry `modelId`. The previous guard built its candidate
  // list as `[existing.modelId, `${existing.modelId}`]` -- the same string
  // twice -- so `used` was always 0, MODEL_IN_USE could never fire, and a model
  // could be deleted while live history still pointed at it. Match on the
  // provider-prefixed form and on the id segment after the colon, so both the
  // raw and prefixed spellings of the same model are caught.
  const suffixes = [existing.modelId, existing.modelId.split(':').pop()];
  const used = await prisma.aiMessage.count({
    where: {
      OR: [
        { model: { in: suffixes } },
        { model: { endsWith: `:${existing.modelId}` } },
      ],
    },
  });
  if (used > 0) throwError('MODEL_IN_USE');
  await prisma.aiModel.delete({ where: { id } });
};

module.exports = { validateModel, listActive, create, update, remove };
