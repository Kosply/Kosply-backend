/**
 * @title Upload controller (thin HTTP over upload.service)
 * @dev The public base is `PUBLIC_BASE_URL` when set (a proxy or CDN in front),
 * @dev otherwise the origin this request arrived on, so the phone that uploaded
 * @dev the photo can always open the URL it gets back.
 */
const env = require('../../config/env');
const service = require('../../services/uploads/upload.service');

const publicBaseOf = (req) => env.publicBaseUrl || `${req.protocol}://${req.get('host')}`;

const image = async (req, res) => {
  const item = await service.saveImage(req.body, req.get('content-type'), publicBaseOf(req));
  res.status(201).json({ status: 'ok', item });
};

module.exports = { image, publicBaseOf };
