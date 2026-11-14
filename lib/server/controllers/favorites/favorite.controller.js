/**
 * @title Favorite controller (thin HTTP over favorite.service)
 */
const service = require('../../services/favorites/favorite.service');

const list = async (req, res) => {
  res.json({ status: 'ok', items: await service.list(req.user) });
};

const add = async (req, res) => {
  res.status(201).json({ status: 'ok', item: await service.add(req.params.productId, req.user) });
};

const remove = async (req, res) => {
  res.json({ status: 'ok', item: await service.remove(req.params.productId, req.user) });
};

module.exports = { list, add, remove };
