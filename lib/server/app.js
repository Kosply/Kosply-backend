/**
 * @title Kosply Express application
 * @notice Builds and exports the Express app (no network binding here).
 * @dev Binding lives in `server.js` so the app stays importable for
 * @dev tests and keeps PM2 cluster behavior predictable.
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const env = require('./config/env');
const routes = require('./routes');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// Trust exactly the configured number of reverse-proxy hops. The previous
// unconditional `1` meant `req.ip` was the right-most `X-Forwarded-For` entry,
// which any client can forge — that feeds both the access log and the analytics
// dedupe key. Default 0 (app is directly exposed); set TRUST_PROXY_HOPS=1
// when nginx really is in front.
app.set('trust proxy', env.trustProxyHops);

// Security + parsing middleware (official Express recommendations).
app.use(helmet());
const corsOrigins =
  env.corsOrigin === '*'
    ? '*'
    : env.corsOrigin
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
app.use(cors({ origin: corsOrigins }));

// Access logging runs before the body parsers on purpose: body-parser rejects
// (400 malformed JSON, 413 too large) before morgan would otherwise see the
// response, which hid every client-side rejection from the log.
if (env.nodeEnv !== 'test') {
  app.use(morgan(env.isDevelopment ? 'dev' : 'combined'));
}

// SSE must never be gzipped: `compressible('text/event-stream')` is true, and
// neither stream handler calls `res.flush()`, so zlib buffers the whole
// response and the client receives every token at once when the stream ends.
const compressionFilter = (req, res) => {
  const type = String(res.getHeader('Content-Type') || '');
  if (type.includes('text/event-stream')) return false;
  return compression.filter(req, res);
};
app.use(compression({ filter: compressionFilter }));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb', parameterLimit: 100 }));

// Feature routes.
app.use('/api', routes);

/**
 * @notice Root health endpoint for PM2 / load-balancer checks.
 * @return {void} Sends `{ name, status, env }` with status 200.
 */
app.get('/', (req, res) => {
  res.json({ name: 'kosply-backend', status: 'ok', env: env.nodeEnv });
});

// 404 + error handlers (must stay last).
app.use(notFound);
app.use(errorHandler);

module.exports = app;
