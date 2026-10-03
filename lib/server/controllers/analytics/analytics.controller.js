/**
 * @title Analytics controller (thin HTTP over analytics.service)
 * @notice Public ingest + seller-only reads.
 */
const service = require('../../services/analytics/analytics.service');

/**
 * @notice Record a catalog event (impression/click). Public.
 * @dev The Flutter client fires `view` when a card enters the feed and
 * @dev `click` when the product detail opens.
 * @param {import('express').Request} req Params `id`, query `type`, `source`, optional `req.user`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', recorded: 'recorded'|'deduped' }`.
 */
const record = async (req, res) => {
  const result = await service.recordEvent(req.params.id, req.query.type, {
    viewerId: req.user?.id,
    source: req.query.source,
    ip: req.ip,
  });
  res.status(201).json({ status: 'ok', recorded: result.status });
};

/**
 * @notice Seller-wide catalog analytics (authenticated seller).
 * @param {import('express').Request} req Query `days?` + `req.user` from JWT.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', item }` with status 200.
 */
const overview = async (req, res) => {
  res.json({ status: 'ok', item: await service.sellerOverview(req.user, req.query) });
};

/**
 * @notice Analytics for one product (owner or ADMIN).
 * @param {import('express').Request} req Params `id`, query `days?` + `req.user`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', item }` with status 200.
 */
const productStats = async (req, res) => {
  const result = await service.productStats(req.params.id, req.user, req.query);
  res.json({ status: 'ok', range: result.range, item: result.item });
};

module.exports = { record, overview, productStats };
