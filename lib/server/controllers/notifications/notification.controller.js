/**
 * @title Notification controller (thin HTTP over notification.service)
 */
const service = require('../../services/notifications/notification.service');

const list = async (req, res) => {
  res.json({ status: 'ok', items: await service.list(req.query, req.user) });
};

const markRead = async (req, res) => {
  res.json({ status: 'ok', item: await service.markRead(req.params.id, req.user) });
};

const markAllRead = async (req, res) => {
  res.json(await service.markAllRead(req.user));
};

const preferences = async (req, res) => {
  res.json({ status: 'ok', items: await service.preferences(req.user) });
};

const setPreference = async (req, res) => {
  res.json({ status: 'ok', item: await service.setPreference(req.body, req.user) });
};

module.exports = { list, markRead, markAllRead, preferences, setPreference };
