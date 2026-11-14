/**
 * @title Email-code controller
 * @notice Thin HTTP over the registration mailbox proof.
 */
const service = require('../../services/auth/email_code.service');

/**
 * @notice Mail a verification code.
 * @param {import('express').Request} req Body `{ email }`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok' }`.
 */
const request = async (req, res) => {
  res.json(await service.request(req.body));
};

/**
 * @notice Check a code and leave it live for registration.
 * @param {import('express').Request} req Body `{ email, code }`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok' }`.
 */
const verify = async (req, res) => {
  res.json(await service.verify(req.body));
};

module.exports = { request, verify };
