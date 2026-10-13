/**
 * @title Tool benchmark controller (thin HTTP over tool.service)
 */
const service = require('../../services/tools/tool.service');

/**
 * @notice Aggregated AI tool metrics for the ops benchmark page.
 * @param {import('express').Request} req Query `days?` + `req.user` from the JWT.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', range, item }` with status 200.
 */
const stats = async (req, res) => {
  const { range, item } = await service.getStats(req.query);
  res.json({ status: 'ok', range, item });
};

module.exports = { stats };
