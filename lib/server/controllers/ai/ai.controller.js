/**
 * @title AI controller (thin HTTP over ai.service, plus SSE piping)
 */
const service = require('../../services/ai/ai.service');
const { throwError } = require('../../middlewares/errorCatalog');

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
  const { status, body } = await service.waitApproval(req.params.id, req.query.timeout);
  res.status(status).json(body);
};

/**
 * @notice Read session history (must belong to future auth scoping).
 * @param {import('express').Request} req Params: `id`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Forwards the agent status and body as-is.
 */
const history = async (req, res) => {
  const { status, body } = await service.history(req.params.id);
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
  const conversationId =
    typeof input.conversation_id === 'string' && input.conversation_id.trim()
      ? input.conversation_id.trim()
      : require('node:crypto').randomUUID();
  let agentRes;
  try {
    agentRes = await fetch(`${agentUrl()}/ai/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        user_id: req.user.id,
        role: req.user.role,
        message: input.message,
        ...(input.ui_state && typeof input.ui_state === 'object' ? { ui_state: input.ui_state } : {}),
      }),
    });
  } catch {
    throwError('AGENT_UNAVAILABLE');
  }
  if (!agentRes.body) throwError('AGENT_UNAVAILABLE');
  res.writeHead(agentRes.status, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  try {
    for await (const chunk of agentRes.body) {
      if (res.destroyed) break;
      res.write(chunk);
    }
  } catch {
    // Client went away mid-stream; the agent run keeps its checkpoint.
  }
  res.end();
};

module.exports = { chat, resume, history, listConversations, waitApproval, stream };
