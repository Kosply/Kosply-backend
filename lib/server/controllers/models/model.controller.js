/**
 * @title Model controller (thin HTTP over model.service)
 */
const service = require('../../services/models/model.service');

const listActive = async (req, res) => {
  res.json({ status: 'ok', items: await service.listActive() });
};

const create = async (req, res) => {
  res.status(201).json({ status: 'ok', item: await service.create(req.body) });
};

const update = async (req, res) => {
  res.json({ status: 'ok', item: await service.update(req.params.id, req.body) });
};

const remove = async (req, res) => {
  await service.remove(req.params.id);
  res.json({ status: 'ok' });
};

module.exports = { listActive, create, update, remove };
