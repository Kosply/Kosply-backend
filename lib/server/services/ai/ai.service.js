/**
 * @title AI proxy service (server -> agent)
 * @notice Forwards authenticated AI calls to the agent microservice.
 * @dev Flutter talks only to this server; user identity always comes from
 * @dev the JWT (never trust client-sent user_id/role) to block persona spoofing.
 */
const crypto = require('node:crypto');

const { throwError } = require('../../middlewares/errorCatalog');

const agentUrl = () => {
  const env = require('../../config/env');
  return process.env.AI_AGENT_URL || env.aiAgentUrl;
};

/**
 * @notice Call the agent with JSON in/out, transparently forwarding status.
 * @param {string} path Agent path (e.g. `/ai/chat`).
 * @param {object} body JSON body for the agent.
 * @return {Promise<{status: number, body: unknown}>} Agent status + parsed body.
 */
const callAgent = async (path, body) => {
  let res;
  try {
    res = await fetch(`${agentUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throwError('AGENT_UNAVAILABLE');
  }
  const data = await res.json().catch(() => null);
  return { status: res.status, body: data || { status: 'error', message: 'Bad agent response' } };
};

/**
 * @notice New or reused conversation id (maps to ai_conversations.id).
 * @param {unknown} raw Client-supplied id.
 * @return {string} The given id, or a fresh UUID.
 */
const conversationId = (raw) =>
  typeof raw === 'string' && raw.trim() ? raw.trim() : crypto.randomUUID();

/**
 * @notice One AI turn through the agent (non-streaming).
 * @param {object} input Raw body `{ conversation_id?, message }`.
 * @param {object} user JWT user `{ id, role }`.
 * @return {Promise<{status: number, body: unknown}>} Agent response as-is.
 */
const chat = (input = {}, user) =>
  callAgent('/ai/chat', {
    conversation_id: conversationId(input.conversation_id),
    user_id: user.id,
    role: user.role,
    message: input.message,
  });

/**
 * @notice Answer a pending approval through the agent.
 * @param {object} input Raw body `{ conversation_id, approve }`.
 * @param {object} user JWT user `{ id, role }`.
 * @return {Promise<{status: number, body: unknown}>} Agent response as-is.
 */
const resume = (input = {}, user) =>
  callAgent('/ai/chat/resume', {
    conversation_id: conversationId(input.conversation_id),
    user_id: user.id,
    approve: input.approve,
  });

/**
 * @notice Read session history through the agent.
 * @param {string} id Conversation id.
 * @return {Promise<{status: number, body: unknown}>} Agent response as-is.
 */
const history = async (id) => {
  let res;
  try {
    res = await fetch(`${agentUrl()}/ai/history/${encodeURIComponent(id)}`);
  } catch {
    throwError('AGENT_UNAVAILABLE');
  }
  const data = await res.json().catch(() => null);
  return { status: res.status, body: data || { status: 'error', message: 'Bad agent response' } };
};

/**
 * @notice List the caller's AI sessions (for the Flutter history list).
 * @dev Read straight from Prisma (no agent round-trip): newest activity first.
 * @param {object} user JWT user `{ id }`.
 * @return {Promise<Array>} `{ id, title, lastMessageAt, createdAt }` scoped to the caller.
 */
const listConversations = async (user) => {
  const { requireDb } = require('../../config/db');
  const prisma = requireDb();
  return prisma.aiConversation.findMany({
    where: { userId: user.id },
    select: { id: true, title: true, lastMessageAt: true, createdAt: true },
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
};

module.exports = { chat, resume, history, listConversations };
