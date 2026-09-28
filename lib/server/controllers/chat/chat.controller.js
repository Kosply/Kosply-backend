/**
 * @title COD chat controller (thin HTTP over chat.service)
 */
const service = require('../../services/chat/chat.service');

const open = async (req, res) => {
  res.status(201).json({ status: 'ok', item: await service.open(req.body, req.user) });
};

const inbox = async (req, res) => {
  res.json({ status: 'ok', items: await service.inbox(req.user) });
};

const get = async (req, res) => {
  res.json({ status: 'ok', item: await service.get(req.params.id, req.user) });
};

const send = async (req, res) => {
  res.status(201).json({ status: 'ok', item: await service.send(req.params.id, req.body, req.user) });
};

const history = async (req, res) => {
  res.json({ status: 'ok', items: await service.history(req.params.id, req.user) });
};

module.exports = { open, inbox, get, send, history };
