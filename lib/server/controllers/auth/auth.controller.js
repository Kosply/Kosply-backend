/**
 * @title Auth controller (thin HTTP over auth.service)
 */
const service = require('../../services/auth/auth.service');

/**
 * @notice Register a buyer.
 * @param {import('express').Request} req Body: register fields.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', user, token }` with status 201.
 */
const register = async (req, res) => {
  const { user, token } = await service.register(req.body);
  res.status(201).json({ status: 'ok', user, token });
};

/**
 * @notice Login with email + password.
 * @param {import('express').Request} req Body: `{ email, password }`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', user, token }` with status 200.
 */
const login = async (req, res) => {
  const { user, token } = await service.login(req.body);
  res.json({ status: 'ok', user, token });
};

module.exports = { register, login };
