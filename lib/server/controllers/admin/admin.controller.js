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

module.exports = { login };
