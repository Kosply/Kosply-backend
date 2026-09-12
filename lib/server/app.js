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

// Security + parsing middleware (official Express recommendations).
app.use(helmet());
app.use(cors({ origin: env.corsOrigin === '*' ? '*' : env.corsOrigin.split(',') }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

if (env.nodeEnv !== 'test') {
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
}

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
