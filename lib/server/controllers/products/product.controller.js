/**
 * @title Product controller (thin HTTP over product.service)
 */
const service = require('../../services/products/product.service');

/**
 * @notice List active products (public).
 * @param {import('express').Request} req Query: `q?`, `limit?`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', items }` with status 200.
 */
const list = async (req, res) => {
  res.json({ status: 'ok', items: await service.list(req.query) });
};

/**
 * @notice Get one product (public).
 * @param {import('express').Request} req Params: `id`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', item }` with status 200.
 */
const detail = async (req, res) => {
  // `req.user` is set only when a token is present; anonymous readers see the
  // public view, staff/owner may also see a non-ACTIVE listing.
  res.json({ status: 'ok', item: await service.detail(req.params.id, req.user || null) });
};

/**
 * @notice Create a product (authenticated SELLER).
 * @param {import('express').Request} req Body fields + `req.user` from JWT.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', item }` with status 201.
 */
const create = async (req, res) => {
  res.status(201).json({ status: 'ok', item: await service.create(req.body, req.user) });
};

/**
 * @notice Update an owned product (owner or ADMIN).
 * @param {import('express').Request} req Params `id` + partial body.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', item }` with status 200.
 */
const update = async (req, res) => {
  res.json({ status: 'ok', item: await service.update(req.params.id, req.body, req.user) });
};

/**
 * @notice Archive an owned product (owner or ADMIN).
 * @param {import('express').Request} req Params: `id`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', item }` with status 200.
 */
const archive = async (req, res) => {
  res.json({ status: 'ok', item: await service.archive(req.params.id, req.user) });
};

/**
 * @notice Mark a product as sold (owner or ADMIN).
 * @param {import('express').Request} req Params: `id`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', item }` with status 200.
 */
const markSold = async (req, res) => {
  res.json({ status: 'ok', item: await service.markSold(req.params.id, req.user) });
};

module.exports = { list, detail, create, update, archive, markSold };
