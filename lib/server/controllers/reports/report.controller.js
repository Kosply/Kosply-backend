/**
 * @title Report controller (thin HTTP over report.service)
 */
const service = require('../../services/reports/report.service');

const file = async (req, res) => {
  res.status(201).json({ status: 'ok', item: await service.file(req.body, req.user) });
};

const list = async (req, res) => {
  res.json({ status: 'ok', items: await service.list(req.query) });
};

const review = async (req, res) => {
  res.json({ status: 'ok', item: await service.review(req.params.id, req.body, req.user) });
};

module.exports = { file, list, review };
