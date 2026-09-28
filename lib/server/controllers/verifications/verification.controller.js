/**
 * @title Verification controller (thin HTTP over verification.service)
 */
const service = require('../../services/verifications/verification.service');

const submit = async (req, res) => {
  res.status(201).json({ status: 'ok', item: await service.submit(req.body, req.user) });
};

const mine = async (req, res) => {
  res.json({ status: 'ok', item: await service.mine(req.user) });
};

const list = async (req, res) => {
  res.json({ status: 'ok', items: await service.list(req.query) });
};

const review = async (req, res) => {
  res.json({ status: 'ok', item: await service.review(req.params.id, req.body, req.user) });
};

module.exports = { submit, mine, list, review };
