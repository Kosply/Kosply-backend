/**
 * @title AI controller (thin HTTP over ai.service, plus SSE piping)
 */
const service = require('../../services/ai/ai.service');
const { throwError } = require('../../middlewares/errorCatalog');

/** @dev Ceiling on a single SSE body, so a runaway agent cannot OOM a worker. */
const MAX_STREAM_BYTES = 8 * 1024 * 1024;

const agentUrl = () => {
  const env = require('../../config/env');
  return process.env.AI_AGENT_URL || env.aiAgentUrl;
};

/**
 * @notice One AI turn (non-streaming), identity taken from the JWT.
 * @param {import('express').Request} req Body `{ conversation_id?, message }` + `req.user`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Forwards the agent status and body as-is.
 */
const chat = async (req, res) => {
  const { status, body } = await service.chat(req.body, req.user);
  // The agent wraps unknown exceptions as `raise ModelError(str(exc))`, and
  // httpx/provider exception strings routinely contain the base URL, the model
  // id, request ids and truncated request payloads. Relay that verbatim and it
  // all reaches the Flutter client. A non-2xx becomes a catalog error with a
  // fixed message; the raw agent text stays in the server log.
  if (status >= 400) {
    console.error(`[ai] agent responded ${status} on /ai/chat:`, JSON.stringify(body));
    const code = status === 404 ? 'AGENT_UNAVAILABLE' : 'AGENT_ERROR';
    throwError(code);
  }
  res.status(status).json(body);
};

/**
 * @notice Answer a pending approval, identity taken from the JWT.
 * @param {import('express').Request} req Body `{ conversation_id, approve }` + `req.user`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Forwards the agent status and body as-is.
 */
const resume = async (req, res) => {
  const { status, body } = await service.resume(req.body, req.user);
  if (status >= 400) {
    console.error(`[ai] agent responded ${status} on /ai/chat/resume:`, JSON.stringify(body));
    throwError(status === 404 ? 'AGENT_UNAVAILABLE' : 'AGENT_ERROR');
  }
  res.status(status).json(body);
};

/**
 * @notice List the caller's AI sessions (Flutter history list).
 * @param {import('express').Request} req `req.user` from JWT (scoping key).
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', items }` with status 200.
 */
const listConversations = async (req, res) => {
  res.json({ status: 'ok', items: await service.listConversations(req.user) });
};

/**
 * @notice Wait for a pending approval (long-poll passthrough).
 * @param {import('express').Request} req Params `id`, query `timeout?`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Forwards the agent status and body as-is.
 */
const waitApproval = async (req, res) => {
  const { status, body } = await service.waitApproval(req.params.id, req.user, req.query.timeout);
  res.status(status).json(body);
};

/**
 * @notice Read session history (must belong to future auth scoping).
 * @param {import('express').Request} req Params: `id`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Forwards the agent status and body as-is.
 */
const history = async (req, res) => {
  const { status, body } = await service.history(req.params.id, req.user);
  res.status(status).json(body);
};

/**
 * @notice Stream one AI turn as SSE by piping the agent response.
 * @dev Identity comes from the JWT; client-sent user_id/role are ignored.
 * @param {import('express').Request} req Body `{ conversation_id?, message, ui_state? }` + `req.user`.
 * @param {import('express').Response} res SSE stream to Flutter.
 * @return {Promise<void>} Pipes agent events until done, then ends.
 */
const stream = async (req, res) => {
  const input = req.body || {};
  const conversationId = await service.resolveStreamConversationId(input.conversation_id, req.user);
  // Abort the upstream agent call when the client disconnects, so a mobile
  // client vanishing does not keep the run (and its LLM spend) alive.
  const ac = new AbortController();
  const onClose = () => ac.abort();
  res.on('close', onClose);
  let agentRes;
  try {
    agentRes = await fetch(`${agentUrl()}/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(require('../../config/env').internalApiKey
          ? { 'x-internal-key': require('../../config/env').internalApiKey }
          : {}),
      },
      body: JSON.stringify(await service.buildTurnBody(input, req.user, conversationId)),
      signal: ac.signal,
    });
  } catch {
    res.off('close', onClose);
    throwError('AGENT_UNAVAILABLE');
  }
  if (!agentRes.ok || !agentRes.body) {
    res.off('close', onClose);
    // A non-2xx must not be re-emitted as an SSE body: the Flutter SSE parser
    // then waits forever for an event that never arrives.
    const detail = await agentRes.json().catch(() => null);
    if (agentRes.status >= 400) {
      // Log the agent's own text; the client gets the catalog message only.
      // Passing `detail.message` through here made the provider error
      // client-visible, because errorHandler forwards `err.message` whenever it
      // considers the message client-safe.
      console.error(`[ai] agent responded ${agentRes.status} on /ai/chat/stream:`, JSON.stringify(detail));
      throwError(agentRes.status === 404 ? 'AGENT_UNAVAILABLE' : 'AGENT_ERROR');
    }
    throwError('AGENT_UNAVAILABLE');
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    // Without this nginx re-buffers the stream and the whole point is lost.
    'x-accel-buffering': 'no',
  });
  let bytes = 0;
  try {
    for await (const chunk of agentRes.body) {
      if (res.destroyed) break;
      bytes += chunk.length;
      if (bytes > MAX_STREAM_BYTES) {
        throw new Error('agent stream exceeded the byte cap');
      }
      // Honour backpressure: discarding the boolean let one slow reader grow
      // the worker's write buffer without bound.
      if (!res.write(chunk)) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
      // compression does not touch SSE (see app.js), but flush defensively in
      // case a proxy re-enables it downstream.
      res.flush?.();
    }
  } catch (err) {
    if (!res.destroyed) {
      // Emit a terminal frame so the client can distinguish "done" from
      // "crashed" instead of hanging on a truncated stream.
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'stream interrupted' })}\n\n`);
    }
  } finally {
    res.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
};

module.exports = { chat, resume, history, listConversations, waitApproval, stream };
