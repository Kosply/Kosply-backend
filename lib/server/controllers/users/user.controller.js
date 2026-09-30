/**
 * @title User controller (thin HTTP over user.service)
 */
const service = require('../../services/users/user.service');

const profile = async (req, res) => {
  res.json({ status: 'ok', item: await service.profile(req.params.id) });
};

const me = async (req, res) => {
  res.json({ status: 'ok', item: await service.me(req.user) });
};

const updateMe = async (req, res) => {
  res.json({ status: 'ok', item: await service.updateMe(req.body, req.user) });
};

module.exports = { profile, me, updateMe };
