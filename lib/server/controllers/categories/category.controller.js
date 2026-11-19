/**
 * @title Category controller
 * @notice Public read of the product category catalog.
 */
const service = require('../../services/categories/category.service');

/**
 * @notice List active categories.
 * @param {import('express').Request} req Unused. The list is not per user.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', items: [{ id, name }] }`.
 */
const list = async (req, res) => {
  res.json({ status: 'ok', items: await service.list() });
};

module.exports = { list };
