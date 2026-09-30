/**
 * @title Admin controller (thin HTTP over admin.service)
 */
const service = require('../../services/admin/admin.service');

/**
 * @notice Dashboard login.
 * @param {import('express').Request} req Body: `{ email, password }`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', admin, token }` with status 200.
 */
const login = async (req, res) => {
  const { admin, token } = await service.login(req.body);
  res.json({ status: 'ok', admin, token });
};

/**
 * @notice Register an admin user (SUPER_ADMIN only).
 * @param {import('express').Request} req Body: admin fields (password set once here).
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', item }` with status 201.
 */
const createAdmin = async (req, res) => {
  res.status(201).json({ status: 'ok', item: await service.createAdmin(req.body) });
};

/**
 * @notice Update an admin user (SUPER_ADMIN only).
 * @param {import('express').Request} req Params `id` + profile/active fields.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', item }` with status 200.
 */
const updateAdmin = async (req, res) => {
  res.json({ status: 'ok', item: await service.updateAdmin(req.params.id, req.body) });
};

/**
 * @notice Self-service admin profile (photo/name/username, password locked).
 * @param {import('express').Request} req Body fields + `req.user`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', item }` with status 200.
 */
const updateMe = async (req, res) => {
  res.json({ status: 'ok', item: await service.updateMe(req.body, req.user) });
};

module.exports = { login, createAdmin, updateAdmin, updateMe };
