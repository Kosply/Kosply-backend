/**
 * @title Support controller (thin HTTP over support.service)
 */
const service = require('../../services/support/support.service');

const open = async (req, res) => {
  res.status(201).json({ status: 'ok', item: await service.open(req.body, req.user) });
};

const list = async (req, res) => {
  res.json({ status: 'ok', items: await service.list(req.query, req.user) });
};

const get = async (req, res) => {
  res.json({ status: 'ok', item: await service.get(req.params.id, req.user) });
};

const reply = async (req, res) => {
  res.status(201).json({ status: 'ok', item: await service.reply(req.params.id, req.body, req.user) });
};

const close = async (req, res) => {
  res.json({ status: 'ok', item: await service.close(req.params.id, req.user) });
};

module.exports = { open, list, get, reply, close };
