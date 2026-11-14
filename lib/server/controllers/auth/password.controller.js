/**
 * @title Password controller (thin HTTP over password.service)
 */
const service = require('../../services/auth/password.service');

const forgot = async (req, res) => {
  res.json(await service.forgot(req.body));
};

const reset = async (req, res) => {
  res.json(await service.reset(req.body));
};

/**
 * @notice Check a reset code and leave the ticket live.
 * @param {import('express').Request} req Body `{ email, code }`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok' }`.
 */
const check = async (req, res) => {
  res.json(await service.check(req.body));
};

module.exports = { forgot, reset, check };
