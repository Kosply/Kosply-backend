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
  // Availability.
  DB_UNAVAILABLE: { status: 503, message: 'Database unavailable' },
  AGENT_UNAVAILABLE: { status: 503, message: 'AI agent unavailable' },
  // Resources.
  PRODUCT_NOT_FOUND: { status: 404, message: 'Product not found' },
  USER_NOT_FOUND: { status: 404, message: 'User not found' },
  CONVERSATION_NOT_FOUND: { status: 404, message: 'Conversation not found' },
  TICKET_NOT_FOUND: { status: 404, message: 'Support ticket not found' },
  REPORT_NOT_FOUND: { status: 404, message: 'Report not found' },
  MODEL_NOT_FOUND: { status: 404, message: 'AI model not found' },
  // Auth.
  EMAIL_TAKEN: { status: 409, message: 'Email already registered' },
  USERNAME_TAKEN: { status: 409, message: 'Username already taken' },
  INVALID_CREDENTIALS: { status: 401, message: 'Invalid email or password' },
  TOKEN_INVALID: { status: 401, message: 'Invalid or expired token' },
  // Intake conflicts and intake state.
  VERIFICATION_EXISTS: { status: 409, message: 'Verification already submitted' },
  MODEL_EXISTS: { status: 409, message: 'Model id already registered' },
  MODEL_IN_USE: { status: 409, message: 'Model is referenced by chat history' },
  RESET_INVALID: { status: 400, message: 'Invalid or expired reset code' },
  // Intake.
  CONTACT_QUEUE_FAILED: { status: 502, message: 'Could not queue contact request' },
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
