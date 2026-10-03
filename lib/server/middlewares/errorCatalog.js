/**
 * @title Backend error catalog
 * @notice Single source of backend error codes, HTTP statuses, and messages.
 * @dev Add new codes here (never inline in controllers) so responses stay
 * @dev consistent and Flutter can switch on `code`. Codes are SCREAMING_SNAKE.
 */
const CODES = {
  // Common.
  INTERNAL: { status: 500, message: 'Internal Server Error' },
  ROUTE_NOT_FOUND: { status: 404, message: 'Route not found' },
  VALIDATION: { status: 400, message: 'Invalid request' },
  UNAUTHORIZED: { status: 401, message: 'Unauthorized' },
  FORBIDDEN: { status: 403, message: 'Forbidden' },
  CONFLICT_UNIQUE: { status: 409, message: 'Resource already exists' },
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  // Availability.
  DB_UNAVAILABLE: { status: 503, message: 'Database unavailable' },
  AGENT_UNAVAILABLE: { status: 503, message: 'AI agent unavailable' },
  AGENT_ERROR: { status: 502, message: 'AI agent request failed' },
  // Resources.
  PRODUCT_NOT_FOUND: { status: 404, message: 'Product not found' },
  USER_NOT_FOUND: { status: 404, message: 'User not found' },
  CONVERSATION_NOT_FOUND: { status: 404, message: 'Conversation not found' },
  TICKET_NOT_FOUND: { status: 404, message: 'Support ticket not found' },
  REPORT_NOT_FOUND: { status: 404, message: 'Report not found' },
  VERIFICATION_NOT_FOUND: { status: 404, message: 'Verification application not found' },
  MODEL_NOT_FOUND: { status: 404, message: 'AI model not found' },
  NOTIFICATION_NOT_FOUND: { status: 404, message: 'Notification not found' },
  // Auth.
  EMAIL_TAKEN: { status: 409, message: 'Email already registered' },
  USERNAME_TAKEN: { status: 409, message: 'Username already taken' },
  INVALID_CREDENTIALS: { status: 401, message: 'Invalid email or password' },
  TOKEN_INVALID: { status: 401, message: 'Invalid or expired token' },
  TOKEN_REVOKED: { status: 401, message: 'Session is no longer valid' },
  SOCIAL_AUTH_FAILED: { status: 401, message: 'Social sign-in failed' },
  SOCIAL_DISABLED: { status: 403, message: 'Social provider is disabled' },
  ACCOUNT_DISABLED: { status: 403, message: 'This account has been disabled' },
  SELLER_NOT_APPROVED: { status: 403, message: 'Seller verification is not active' },
  INTERNAL_KEY_REQUIRED: { status: 401, message: 'Internal service key required' },
  // Intake conflicts and intake state.
  VERIFICATION_EXISTS: { status: 409, message: 'Verification already submitted' },
  VERIFICATION_DECIDED: { status: 409, message: 'This application has already been decided' },
  REPORT_DECIDED: { status: 409, message: 'This report has already been decided' },
  TICKET_CLOSED: { status: 409, message: 'This support ticket is closed' },
  MODEL_EXISTS: { status: 409, message: 'Model id already registered' },
  MODEL_IN_USE: { status: 409, message: 'Model is referenced by chat history' },
  RESET_INVALID: { status: 400, message: 'Invalid or expired reset code' },
  // Throttling. The Express API had no rate limiting at all, so login,
  // register and password-reset were unlimited password-guessing surfaces.
  RATE_LIMITED: { status: 429, message: 'Too many requests, please slow down' },
  // Intake.
  CONTACT_QUEUE_FAILED: { status: 502, message: 'Could not queue contact request' },
  // Protocol-level rejections raised by body-parser / Node core, mapped in
  // errorHandler so a client mistake never surfaces as a 500-class code.
  PAYLOAD_TOO_LARGE: { status: 413, message: 'Request body too large' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'Unsupported content type' },
  MALFORMED_REQUEST: { status: 400, message: 'Malformed request' },
};

/**
 * @notice Catalog-backed error thrown by controllers and helpers.
 */
class ApiError extends Error {
  /**
   * @param {string} code Catalog key from `CODES`.
   * @param {object} [opts] Optional overrides.
   * @param {string} [opts.message] Replaces the catalog message.
   * @param {unknown} [opts.details] Machine-readable extra (echoed in responses).
   */
  constructor(code, opts = {}) {
    const entry = CODES[code] || CODES.INTERNAL;
    super(opts.message || entry.message);
    this.code = CODES[code] ? code : 'INTERNAL';
    this.statusCode = entry.status;
    if (opts.details !== undefined) this.details = opts.details;
  }
}

/**
 * @notice Throw a catalog error (keeps controllers one-liners).
 * @param {string} code Catalog key.
 * @param {object} [opts] Message/details overrides, see `ApiError`.
 * @return {never} Always throws.
 */
const throwError = (code, opts) => {
  throw new ApiError(code, opts);
};

module.exports = { CODES, ApiError, throwError };
