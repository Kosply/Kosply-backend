/**
 * @title Kosply table registry
 * @notice Every table and column the app is allowed to touch, with its wire type.
 * @dev This file is the source of truth that `schema/schema.db` used to be under
 * @dev Prisma. DDL lives in `schema/migrations/*.sql`; this registry describes
 * @dev the *shape* of a row, and three things depend on it:
 * @dev  1. `sql.js` validates column names, so a typo becomes a throw at
 * @dev     development time instead of `ER_BAD_FIELD_ERROR` at runtime.
 * @dev  2. `cast.js` coerces every row to the JS types the API contract
 * @dev     promises (booleans as `true`/`false`, dates as `Date`, JSON columns
 * @dev     parsed). MariaDB has no BOOLEAN and no JSON type, so without this
 * @dev     the API would serialise `isActive: 1` and break the client.
 * @dev  3. `sql.js` writes `updatedAt` automatically, matching what Prisma's
 * @dev     `@updatedAt` did. The column is `NOT NULL` with no default, so an
 * @dev     update that forgot it would fail outright.
 * @dev Column types are the *wire* types. `id` columns are `varchar(191)`
 * @dev holding a cuid2; `enum` columns are native MariaDB ENUMs whose members
 * @dev are written as bare strings (the app never imports a generated enum).
 */

/** @notice Wire type tags, and how each behaves. @dev */
const TYPES = {
  /** @dev cuid2 primary key, generated on insert when absent. */
  id: { sql: 'varchar(191)', js: 'string', auto: true },
  /** @dev `varchar(191)`. */
  str: { sql: 'varchar(191)', js: 'string' },
  /** @dev `text`, for unbounded prose (bio, message bodies). */
  text: { sql: 'text', js: 'string' },
  /** @dev `int(11)` — rupiah amounts, counts, stock. */
  int: { sql: 'int(11)', js: 'number' },
  /** @dev `double` — coordinates and per-token prices. */
  float: { sql: 'double', js: 'number' },
  /** @dev `tinyint(1)`. Written as 1/0, always read back as true/false. */
  bool: { sql: 'tinyint(1)', js: 'boolean' },
  /** @dev `datetime(3)`, always UTC. */
  date: { sql: 'datetime(3)', js: 'date' },
  /** @dev `longtext` holding a JSON document, guarded by a `json_valid()` CHECK. */
  json: { sql: 'longtext', js: 'json' },
  /** @dev Native MariaDB ENUM. Value is a bare string. */
  enum: { sql: 'enum', js: 'string' },
};

/**
 * @notice Table definitions, keyed by physical table name.
 * @dev Column order matches the DDL so `SELECT *` and explicit lists agree.
 */
const TABLES = {
  users: {
    id: 'id',
    email: 'str',
    username: 'str',
    name: 'str',
    passwordHash: 'str',
    googleId: 'str',
    appleId: 'str',
    universitas: 'str',
    programStudi: 'str',
    bio: 'text',
    photo: 'str',
    isActive: 'bool',
    role: 'enum',
    createdAt: 'date',
    updatedAt: 'date',
  },

  seller_verifications: {
    id: 'id',
    userId: 'str',
    namaLengkap: 'str',
    nim: 'str',
    universitas: 'str',
    programStudi: 'str',
    ktmImageUrl: 'str',
    status: 'enum',
    isActive: 'bool',
    action: 'enum',
    actionNote: 'str',
    reviewedBy: 'str',
    rejectionReason: 'str',
    reviewedAt: 'date',
    createdAt: 'date',
    updatedAt: 'date',
  },

  products: {
    id: 'id',
    sellerId: 'str',
    title: 'str',
    description: 'text',
    price: 'int',
    stock: 'int',
    imageUrls: 'json',
    category: 'str',
    latitude: 'float',
    longitude: 'float',
    locationLabel: 'str',
    status: 'enum',
    soldAt: 'date',
    createdAt: 'date',
    updatedAt: 'date',
  },

  product_events: {
    id: 'id',
    productId: 'str',
    type: 'enum',
    viewerId: 'str',
    source: 'str',
    createdAt: 'date',
  },

  conversations: {
    id: 'id',
    productId: 'str',
    buyerId: 'str',
    sellerId: 'str',
    agreedLatitude: 'float',
    agreedLongitude: 'float',
    agreedLocationLabel: 'str',
    lastMessageAt: 'date',
    createdAt: 'date',
    updatedAt: 'date',
  },

  messages: {
    id: 'id',
    conversationId: 'str',
    senderId: 'str',
    type: 'enum',
    text: 'text',
    imageUrl: 'str',
    latitude: 'float',
    longitude: 'float',
    locationLabel: 'str',
    isRead: 'bool',
    readAt: 'date',
    createdAt: 'date',
  },

  support_tickets: {
    id: 'id',
    ticketNo: 'str',
    userId: 'str',
    category: 'enum',
    status: 'enum',
    subject: 'str',
    description: 'text',
    lastMessageAt: 'date',
    createdAt: 'date',
    updatedAt: 'date',
  },

  support_messages: {
    id: 'id',
    ticketId: 'str',
    senderId: 'str',
    senderRole: 'str',
    senderName: 'str',
    text: 'text',
    imageUrl: 'str',
    isInternal: 'bool',
    isRead: 'bool',
    readAt: 'date',
    createdAt: 'date',
  },

  reports: {
    id: 'id',
    reportNo: 'str',
    reporterId: 'str',
    reportedUserId: 'str',
    reportedProductId: 'str',
    category: 'enum',
    description: 'text',
    evidenceUrls: 'json',
    status: 'enum',
    action: 'enum',
    actionNote: 'str',
    reviewedBy: 'str',
    reviewedAt: 'date',
    createdAt: 'date',
    updatedAt: 'date',
  },

  admins: {
    id: 'id',
    email: 'str',
    name: 'str',
    passwordHash: 'str',
    isActive: 'bool',
    createdAt: 'date',
    updatedAt: 'date',
  },

  password_resets: {
    id: 'id',
    userId: 'str',
    email: 'str',
    codeHash: 'str',
    expiresAt: 'date',
    attempts: 'int',
    consumedAt: 'date',
    createdAt: 'date',
  },

  notifications: {
    id: 'id',
    userId: 'str',
    type: 'str',
    title: 'str',
    body: 'text',
    data: 'json',
    isRead: 'bool',
    readAt: 'date',
    createdAt: 'date',
  },

  notification_preferences: {
    userId: 'str',
    key: 'str',
    enabled: 'bool',
    createdAt: 'date',
    updatedAt: 'date',
    /** @dev Composite primary key: there is no surrogate id on this table. */
    __primaryKey: ['userId', 'key'],
  },

  ai_conversations: {
    id: 'id',
    userId: 'str',
    title: 'str',
    lastMessageAt: 'date',
    createdAt: 'date',
    updatedAt: 'date',
  },

  ai_messages: {
    id: 'id',
    conversationId: 'str',
    role: 'enum',
    content: 'text',
    model: 'str',
    createdAt: 'date',
  },

  ai_models: {
    id: 'id',
    modelId: 'str',
    name: 'str',
    inputPrice: 'float',
    outputPrice: 'float',
    cacheReadPrice: 'float',
    isActive: 'bool',
    createdAt: 'date',
    updatedAt: 'date',
  },

  tool_invocations: {
    id: 'id',
    tool: 'str',
    model: 'str',
    userId: 'str',
    status: 'enum',
    latencyMs: 'int',
    createdAt: 'date',
  },

  refresh_tokens: {
    id: 'id',
    /**
     * @dev `'user'` for a `users` row, `'admin'` for an `admins` row. The two
     * @dev id namespaces are disjoint, so there is deliberately no FK to either
     * @dev table — the same reason `seller_verifications.reviewedBy` has none.
     * @dev Using `'id'` here would be read as a foreign key.
     */
    subjectType: 'str',
    subjectId: 'str',
    /** @dev Every token descended from one login shares this, for reuse detection. */
    familyId: 'str',
    /** @dev HMAC-SHA256 of the token, never the token itself. */
    tokenHash: 'str',
    expiresAt: 'date',
    /** @dev Set when this token was rotated away. A replay is therefore recognisable. */
    consumedAt: 'date',
    /** @dev Set when the session was ended on purpose (logout, reuse detection). */
    revokedAt: 'date',
    /** @dev The successor token issued when this one was rotated. Audit trail. */
    replacedById: 'str',
    userAgent: 'str',
    ip: 'str',
    createdAt: 'date',
  },
};

/**
 * @notice Relation edges, so a `where` can filter through an association.
 * @dev Prisma expressed these as nested conditions (`{ events: { some: … } }`)
 * @dev and compiled them to a correlated subquery. The data layer does the same,
 * @dev which is why the analytics routes can ask for "products with traffic in
 * @dev this window" and "messages whose room is about one of these products"
 * @dev without either service writing SQL.
 * @dev Each edge is `{ table, to, from }`: rows in `table` whose `to` column
 * @dev equals this table's `from` column. For a to-one edge (`conversation`),
 * @dev the filter compiles to an EXISTS as well, which is equivalent to a join
 * @dev and avoids duplicating rows in the result.
 */
const RELATIONS = {
  products: {
    events: { table: 'product_events', from: 'id', to: 'productId' },
    conversations: { table: 'conversations', from: 'id', to: 'productId' },
  },
  messages: {
    conversation: { table: 'conversations', from: 'conversationId', to: 'id' },
  },
  product_events: {
    product: { table: 'products', from: 'productId', to: 'id' },
  },
  conversations: {
    product: { table: 'products', from: 'productId', to: 'id' },
    messages: { table: 'messages', from: 'id', to: 'conversationId' },
  },
  support_messages: {
    ticket: { table: 'support_tickets', from: 'ticketId', to: 'id' },
  },
  ai_messages: {
    conversation: { table: 'ai_conversations', from: 'conversationId', to: 'id' },
  },
  reports: {
    reportedProduct: { table: 'products', from: 'reportedProductId', to: 'id' },
    reportedUser: { table: 'users', from: 'reportedUserId', to: 'id' },
  },
  seller_verifications: {
    user: { table: 'users', from: 'userId', to: 'id' },
  },
};

/**
 * @notice Build the per-table lookups `sql.js` and `cast.js` ask for.
 * @dev Computed once at require time; these are read on every query.
 * @param {string} table Physical table name.
 * @return {object|null} Derived metadata, or null for an unknown table.
 */
const describe = (table) => {
  const columns = TABLES[table];
  if (!columns) return null;
  // `__primaryKey` is metadata, not a column; it must never reach a query.
  const { __primaryKey, ...dataColumns } = columns;
  return {
    table,
    columns: dataColumns,
    names: Object.keys(dataColumns),
    typeOf: (column) => dataColumns[column],
    primaryKey: __primaryKey || ['id'],
    hasUpdatedAt: Object.prototype.hasOwnProperty.call(dataColumns, 'updatedAt'),
    hasCreatedAt: Object.prototype.hasOwnProperty.call(dataColumns, 'createdAt'),
  };
};

/**
 * @notice Quote a MariaDB identifier.
 * @dev Backticks, not string interpolation into the query: `key` is a reserved
 * @dev word in MariaDB and would be a syntax error unquoted, and a column name
 * @dev arriving from caller data must never be able to break out of the query.
 * @param {string} identifier Table or column name.
 * @return {string} Backticked identifier.
 */
const quote = (identifier) => `\`${String(identifier).replace(/`/g, '')}\``;

module.exports = { RELATIONS, TYPES, TABLES, describe, quote };