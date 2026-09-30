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

/**
 * @notice Long-poll for a reply (the "nunggu" wait with timeout).
 * @param {import('express').Request} req Params `id`, query `after?`, `timeout?` (seconds).
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', outcome: 'new'|'waiting', messages }`.
 */
const wait = async (req, res) => {
  const out = await service.waitForMessages(req.params.id, req.user, {
    after: req.query.after,
    timeoutS: req.query.timeout,
  });
  res.json({ status: 'ok', ...out });
};

/**
 * @notice SSE stream of incoming messages (event-based wait, no client timeout).
 * @dev Replays recent history first (cap 50), then emits live rows + `: ping`
 * @dev heartbeats, ending with `done` at 55s or on client disconnect.
 * @param {import('express').Request} req Params `id`, query `after?`.
 * @param {import('express').Response} res SSE stream to Flutter.
 * @return {Promise<void>} Streams `message` events until done.
 */
const stream = async (req, res) => {
  await service.get(req.params.id, req.user);
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  let cursor = typeof req.query.after === 'string' && req.query.after ? req.query.after : null;
  const capS = Math.min(Math.max(Number(req.query.timeout) || 55, 1), 55);
  const started = Date.now();
  let lastBeat = 0;
  const closed = () => res.destroyed || res.writableEnded;
  try {
    for (;;) {
      if (closed()) break;
      const rows = await service.fetchAfter(req.params.id, cursor);
      for (const row of rows) {
        if (closed()) break;
        cursor = row.id;
        res.write(`event: message\ndata: ${JSON.stringify(row)}\n\n`);
      }
      if (Date.now() - started > capS * 1000) break;
      if (Date.now() - lastBeat > 15000) {
        lastBeat = Date.now();
        if (!closed()) res.write(': ping\n\n');
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch {
    // Client went away; nothing to clean (stateless polling).
  }
  if (!closed()) res.write('event: done\ndata: {"ok":true}\n\n');
  res.end();
};

module.exports = { open, inbox, get, send, history, wait, stream };
