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

module.exports = { forgot, reset };
