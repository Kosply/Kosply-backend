/**
 * @title COD chat controller (thin HTTP over chat.service)
 */
const service = require('../../services/chat/chat.service');

/** @dev Ceiling on one SSE stream, matching the long-poll budget. */
const MAX_STREAM_SECONDS = 55;
/**
 * @dev History poll cadence, and the keepalive interval. Both are the same
 * @dev value on purpose: a ping that arrives between polls keeps the socket
 * @dev warm, and the client is not told anything arrives "soon".
 * @dev These were two names for one number and a stale reference to the old
 * @dev name made the whole stream raise a ReferenceError on its first poll.
 */
const POLL_INTERVAL_MS = 1000;

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
  const { requireDb } = require('../../config/db');
  // Authorise with a select-only membership probe: `get` hydrated the entire
  // message history just to discard it.
  await service.assertMember(requireDb(), req.params.id, req.user);
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    // Without this a reverse proxy re-buffers and the stream is pointless.
    'x-accel-buffering': 'no',
  });
  // Type-check the cursor before the response starts: a non-string (array or
  // object from the query parser) used to reach Prisma and 500 mid-stream,
  // leaving the client with 200 and no terminal event.
  let cursor;
  try {
    cursor = req.query.after ? require('../../services/shared/validators').toId(req.query.after, 'after') : null;
    // With no cursor the client gets the recent page first, then the loop below
    // advances the cursor and delivers anything new. Without this a client
    // that never persisted a cursor rendered an empty chat forever.
    if (!cursor) {
      const recent = await service.fetchLatest(req.params.id);
      for (const row of recent) {
        res.write(`event: message\ndata: ${JSON.stringify(row)}\n\n`);
      }
      if (recent.length) cursor = recent[recent.length - 1].id;
    }
    const capS = require('../../services/shared/validators').toQueryInt(req.query.timeout, 'timeout', {
      min: 1,
      max: MAX_STREAM_SECONDS,
      fallback: MAX_STREAM_SECONDS,
    });
    const started = Date.now();
    let lastBeat = 0;
    const closed = () => res.destroyed || res.writableEnded;
    for (;;) {
      if (closed()) break;
      const rows = await service.fetchAfter(req.params.id, cursor);
      for (const row of rows) {
        if (closed()) break;
        cursor = row.id;
        res.write(`event: message\ndata: ${JSON.stringify(row)}\n\n`);
        res.flush?.();
      }
      if (Date.now() - started > capS * 1000) break;
      if (Date.now() - lastBeat > POLL_INTERVAL_MS) {
        lastBeat = Date.now();
        if (!closed()) res.write(': ping\n\n');
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } catch (err) {
    // A client-side cursor error must not be reported as a clean `done`.
    if (!res.destroyed) {
      console.error('[chat] stream failed:', err.message);
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'stream interrupted' })}\n\n`);
    }
  }
  if (!res.destroyed && !res.writableEnded) {
    res.write('event: done\ndata: {"ok":true}\n\n');
  }
  res.end();
};

module.exports = { open, inbox, get, send, history, wait, stream };
