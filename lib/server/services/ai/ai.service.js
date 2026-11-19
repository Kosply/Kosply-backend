/**
 * @title AI proxy service (server -> agent)
 * @notice Forwards authenticated AI calls to the agent microservice.
 * @dev Flutter talks only to this server; user identity always comes from
 * @dev the JWT (never trust client-sent user_id/role) to block persona spoofing.
 * @dev Every forwarded call re-checks conversation ownership in the database
 * @dev first. `chat`/`resume`/`history`/`wait` previously forwarded a
 * @dev client-supplied `conversation_id` with no ownership check, so any
 * @dev authenticated user could read, inject into, or — via `resume` — supply
 * @dev the approval for another user's AI thread. An approval interrupt is the
 * @dev agent's consent gate, so `resume` was the worst of the five.
 * @dev All agent calls carry a timeout; without one a hung agent held the
 * @dev Express request open indefinitely.
 */
const crypto = require('node:crypto');

const { throwError } = require('../../middlewares/errorCatalog');
const {
  toId,
  toText,
  toInt,
  toNumber,
  toUrlList,
  MAX_MESSAGE_LENGTH,
  MAX_PRICE_RP,
  INT4_MAX,
} = require('../shared/validators');
const { activeNames } = require('../categories/category.service');

/**
 * @dev Ceiling for a non-streaming agent call.
 * @dev Must exceed the agent's OWN worst case: it may spend
 * @dev `AI_QUEUE_TIMEOUT_S (5) + AI_MODEL_TIMEOUT_S (120) = 125s` before
 * @dev answering or returning its own 504. At 60s the server aborted first and
 * @dev reported 503 AGENT_UNAVAILABLE for a turn that was merely slow — and
 * @dev uvicorn does not cancel a non-streaming handler on client disconnect,
 * @dev so the graph kept running to completion and kept billing the LLM.
 */
const AGENT_TIMEOUT_MS = Number.parseInt(process.env.AI_AGENT_TIMEOUT_MS || '180000', 10);
/** @dev Slack added to a client-requested wait before the transport gives up. */
const WAIT_TRANSPORT_SLACK_MS = 15_000;
/** @dev Absolute ceiling for the long-poll transport, regardless of the request. */
const AGENT_WAIT_MAX_MS = Number.parseInt(process.env.AI_AGENT_WAIT_MAX_MS || '300000', 10);
/** @dev Max client-requested long-poll, in seconds (agent allows up to 1500). */
const MAX_WAIT_SECONDS = 120;
/** @dev Ceiling on the `ui_state` blob, matching the agent's own cap. */
const MAX_UI_STATE_CHARS = 8000;
/**
 * @dev Same cap as a product write. The phone takes the photo, uploads it
 * @dev through the existing image URL handoff (there is no camera or binary
 * @dev upload on this server), then sends the resulting `http(s)` URLs here.
 * @dev A 9th URL is not forwarded.
 */
const MAX_LISTING_IMAGES = 8;

const agentUrl = () => {
  const env = require('../../config/env');
  return process.env.AI_AGENT_URL || env.aiAgentUrl;
};

/**
 * @dev The agent now requires the same shared secret on every call, so the
 * @dev server has to present it. Without this header every proxied call is 401.
 */
const agentHeaders = () => {
  const { internalApiKey } = require('../../config/env');
  return {
    'content-type': 'application/json',
    ...(internalApiKey ? { 'x-internal-key': internalApiKey } : {}),
  };
};

/**
 * @notice Assert the caller owns the conversation before it is forwarded.
 * @dev A conversation that does not exist yet is allowed (first turn); an
 * @dev existing one owned by somebody else is a 404, so the id is not
 * @dev confirmed to exist.
 * @param {string} id Conversation id.
 * @param {object} user JWT user `{ id }`.
 * @return {Promise<string>} The conversation id.
 */
const assertConversationOwnership = async (id, user) => {
  const { getDb } = require('../../config/db');
  const db = getDb();
  // Degraded mode: without a database the ownership check is skipped and the
  // agent is left to enforce it. Kept deliberately — CI smoke tests boot the
  // server with no `DATABASE_URL` and must still serve.
  if (!db) return id;
  const existing = await db.selectOne('ai_conversations', {
    where: { id },
    columns: ['userId'],
  });
  // Unknown id: the agent will create it for this user. Known id: must match.
  if (existing && existing.userId !== user.id) throwError('CONVERSATION_NOT_FOUND');
  return id;
};

/**
 * @notice Call the agent with JSON in/out, transparently forwarding status.
 * @dev `signal` bounds the call; the agent's error body is *not* relayed to
 * @dev the client (it can carry provider errors, prompts and internal URLs).
 * @param {string} path Agent path (e.g. `/ai/chat`).
 * @param {object} body JSON body for the agent.
 * @param {number} [timeoutMs] Request timeout.
 * @return {Promise<{status: number, body: unknown}>} Agent status + parsed body.
 */
const callAgent = async (path, body, timeoutMs = AGENT_TIMEOUT_MS) => {
  let res;
  try {
    res = await fetch(`${agentUrl()}${path}`, {
      method: 'POST',
      headers: agentHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') throwError('AGENT_UNAVAILABLE', { details: 'agent timed out' });
    throwError('AGENT_UNAVAILABLE');
  }
  const data = await res.json().catch(() => null);
  return { status: res.status, body: data || { status: 'error', message: 'Bad agent response' } };
};

/**
 * @notice Call a GET agent endpoint with a bounded timeout.
 * @param {string} url Fully-built agent URL.
 * @param {number} [timeoutMs] Request timeout.
 * @return {Promise<{status: number, body: unknown}>} Agent status + parsed body.
 */
const callAgentGet = async (url, timeoutMs = AGENT_TIMEOUT_MS) => {
  let res;
  try {
    res = await fetch(url, { headers: agentHeaders(), signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === 'TimeoutError') throwError('AGENT_UNAVAILABLE', { details: 'agent timed out' });
    throwError('AGENT_UNAVAILABLE');
  }
  const data = await res.json().catch(() => null);
  return { status: res.status, body: data || { status: 'error', message: 'Bad agent response' } };
};

/**
 * @notice Resolve and authorise a conversation id from a request body.
 * @param {unknown} raw Client-supplied id.
 * @param {object} user JWT user `{ id }`.
 * @return {Promise<string>} The authorised conversation id.
 */
const resolveConversation = async (raw, user) => {
  const id = typeof raw === 'string' && raw.trim() ? raw.trim() : crypto.randomUUID();
  // A client-supplied id is a cuid/uuid; anything else is rejected before it
  // can reach a path segment or the checkpointer.
  return assertConversationOwnership(toId(id, 'conversation_id', { maxLength: 64 }) || id, user);
};

/**
 * @notice One AI turn through the agent (non-streaming).
 * @param {object} input Raw body `{ conversation_id?, message, ui_state? }`.
 * @param {object} user JWT user `{ id, role }`.
 * @return {Promise<{status: number, body: unknown}>} Agent response as-is.
 */
const chat = async (input = {}, user) => {
  const conversation_id = await resolveConversation(input.conversation_id, user);
  return callAgent('/ai/chat', await buildTurnBody(input, user, conversation_id));
};

/**
 * @dev Side photos are already-uploaded http(s) URLs (`imageUrls`), the same
 * @dev shape a product write accepts. They are forwarded beside `message` so
 * @dev a multi-side listing is not rejected by the 4000-character text cap.
 * @param {object} input Raw body.
 * @return {string[]|null} Capped URL list, or null when the client sent none.
 */
const readListingPhotos = (input) => {
  const raw = input.imageUrls !== undefined ? input.imageUrls : input.image_urls;
  if (raw === undefined || raw === null || raw === '') return null;
  if (!Array.isArray(raw)) {
    throwError('VALIDATION', { details: 'imageUrls must be an array' });
  }
  if (raw.length === 0) return null;
  // Drop a 9th side before validation so it is never stored or forwarded.
  return toUrlList(raw.slice(0, MAX_LISTING_IMAGES), 'imageUrls', { maxItems: MAX_LISTING_IMAGES });
};

/**
 * @notice Validate one AI turn's payload.
 * @dev Shared by `chat` and the SSE `stream` route. The streaming path used to
 * @dev forward `message` raw, so a missing, non-string or oversized message
 * @dev surfaced as a 502 from the agent instead of a 400, and the streaming
 * @dev route was materially weaker than the non-streaming one.
 * @dev `ui_state` is size-capped here too: the agent's own check raised a bare
 * @dev `ValueError`, which no AgentError handler matched, so a client mistake
 * @dev became an unhandled 500 (plus a traceback in the agent log).
 * @dev `imageUrls` is forwarded beside `message`. Photo URLs are not folded
 * @dev into the text, so the 4000-character message cap cannot reject them.
 * @param {object} input Raw body `{ message, ui_state?, imageUrls?, price?, stock? }`.
 * @param {object} user JWT user `{ id, role }`.
 * @param {string} conversation_id Authorised conversation id.
 * @return {Promise<object>} Body for the agent.
 */
const buildTurnBody = async (input = {}, user, conversation_id) => {
  const photos = readListingPhotos(input);
  // Chat vision: the phone already uploaded the listing photos and wants the
  // assistant to look at them without leaving the chatbot for a listing card.
  const seePhotos = input.see_photos === true || input.seePhotos === true;
  const hasPrice = input.price !== undefined && input.price !== null && input.price !== '';
  const hasStock = input.stock !== undefined && input.stock !== null && input.stock !== '';
  const rawMessage = input.message;
  const messageMissing = rawMessage === undefined || rawMessage === null || String(rawMessage).trim() === '';
  // A chatbot turn still requires text. A photo turn or a price+stock turn
  // may omit it; the placeholder is not the photo payload.
  let message;
  if (messageMissing && !photos && !(hasPrice && hasStock)) {
    message = toText(rawMessage, 'message', { min: 1, max: MAX_MESSAGE_LENGTH });
  } else if (messageMissing && photos) {
    message = 'Foto barang yang akan dijual.';
  } else if (messageMissing) {
    message = 'Harga dan stok.';
  } else {
    message = toText(rawMessage, 'message', { min: 1, max: MAX_MESSAGE_LENGTH });
  }
  // The listing-card prompt reads "Daftar kategori". A chat turn that is only
  // looking at the photos keeps the student's words unchanged.
  if (photos && !seePhotos) message = await appendCategoryList(message);
  const body = {
    conversation_id,
    user_id: user.id,
    role: user.role,
    message,
  };
  if (photos) body.image_urls = photos;
  if (photos && seePhotos) body.see_photos = true;
  if (hasPrice) body.price = toInt(input.price, 'price', { min: 0, max: MAX_PRICE_RP });
  if (hasStock) body.stock = toInt(input.stock, 'stock', { min: 0, max: INT4_MAX });
  const ui = input.ui_state;
  if (ui !== undefined && ui !== null && ui !== '') {
    if (typeof ui !== 'object' || Array.isArray(ui)) {
      throwError('VALIDATION', { details: 'ui_state must be an object' });
    }
    let size;
    try {
      size = JSON.stringify(ui).length;
    } catch {
      throwError('VALIDATION', { details: 'ui_state must be JSON-serialisable' });
    }
    if (size > MAX_UI_STATE_CHARS) {
      throwError('VALIDATION', {
        details: `ui_state is too large (max ${MAX_UI_STATE_CHARS} characters)`,
      });
    }
    body.ui_state = ui;
  }
  return body;
};

/**
 * @notice Append the seeded category names to a photo caption.
 * @dev The listing prompt tells the model to copy one name from this line.
 * The dropdown reads the same table, so the two cannot drift. A caption that
 * is already at the message cap is left unchanged.
 * @param {string} message Caption already accepted by the message cap.
 * @return {Promise<string>} Caption, plus `Daftar kategori:` when it fits.
 */
const appendCategoryList = async (message) => {
  const names = await activeNames();
  if (!names.length) return message;
  const line = `Daftar kategori: ${names.join(', ')}`;
  const next = `${message}\n${line}`;
  if (next.length > MAX_MESSAGE_LENGTH) return message;
  return next;
};

/**
 * @notice Answer a pending approval through the agent.
 * @dev `approve` is coerced to a real boolean: the raw value used to be
 * @dev forwarded, so `"false"`, `0` and `null` were truthy for the agent.
 * @param {object} input Raw body `{ conversation_id, approve }`.
 * @param {object} user JWT user `{ id }`.
 * @return {Promise<{status: number, body: unknown}>} Agent response as-is.
 */
const resume = async (input = {}, user) => {
  const conversation_id = await resolveConversation(input.conversation_id, user);
  if (typeof input.approve !== 'boolean') {
    throwError('VALIDATION', { details: 'approve must be a boolean' });
  }
  return callAgent('/ai/chat/resume', {
    conversation_id,
    user_id: user.id,
    approve: input.approve,
  });
};

/**
 * @notice Read session history through the agent.
 * @dev Previously sent no `user_id` at all and no ownership check.
 * @param {string} id Conversation id.
 * @param {object} user JWT user `{ id }`.
 * @return {Promise<{status: number, body: unknown}>} Agent response as-is.
 */
const history = async (id, user) => {
  const owned = await assertConversationOwnership(toId(id, 'id'), user);
  return callAgentGet(
    `${agentUrl()}/ai/history/${encodeURIComponent(owned)}?user_id=${encodeURIComponent(user.id)}`
  );
};

/**
 * @notice List the caller's AI sessions (for the Flutter history list).
 * @dev Read straight from the database (no agent round-trip): newest activity first.
 * @param {object} user JWT user `{ id }`.
 * @return {Promise<Array>} `{ id, title, lastMessageAt, createdAt }` scoped to the caller.
 */
const listConversations = async (user) => {
  const { requireDb } = require('../../config/db');
  const db = requireDb();
  return db.selectMany('ai_conversations', {
    where: { userId: user.id },
    columns: ['id', 'title', 'lastMessageAt', 'createdAt'],
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    limit: 100,
  });
};

/**
 * @notice Wait for a pending user approval (long-poll).
 * @dev Timeout is clamped to 1..120s instead of passing the client's value
 * @dev straight through (which allowed one request to hold a socket for 25
 * @dev minutes and the worker with it).
 * @param {string} id Conversation id.
 * @param {object} user JWT user `{ id }`.
 * @param {unknown} timeout Seconds requested.
 * @return {Promise<{status: number, body: unknown}>} Agent response as-is.
 */
const waitApproval = async (id, user, timeout) => {
  const owned = await assertConversationOwnership(toId(id, 'id'), user);
  const seconds = Math.min(
    Math.max(toNumber(timeout ?? 60, 'timeout', { min: 1, max: 100000 }) || 60, 1),
    MAX_WAIT_SECONDS
  );
  return callAgentGet(
    `${agentUrl()}/ai/wait/${encodeURIComponent(owned)}?timeout=${seconds}&user_id=${encodeURIComponent(user.id)}`,
    // The transport budget must exceed the wait the client actually asked for.
    // It was a flat 90s while MAX_WAIT_SECONDS is 120, so any request for
    // 91..120s was aborted by the transport at 90s and reported as 503
    // AGENT_UNAVAILABLE instead of the agent's own clean
    // `{status: "timeout", remainingS: 0}`.
    Math.min((seconds + WAIT_TRANSPORT_SLACK_MS) * 1000, AGENT_WAIT_MAX_MS)
  );
};

/**
 * @notice Authorise a conversation id for the streaming route.
 * @param {unknown} raw Client-supplied id.
 * @param {object} user JWT user `{ id }`.
 * @return {Promise<string>} The authorised conversation id.
 */
const resolveStreamConversationId = (raw, user) => resolveConversation(raw, user);

module.exports = {
  chat,
  resume,
  history,
  listConversations,
  waitApproval,
  resolveStreamConversationId,
  buildTurnBody,
};
