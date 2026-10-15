# Kosply DB Spec

Source: `lib/db/schema/migrations/*.sql` applied to MariaDB 11.4, described by
`lib/db/src/schema.js`. Status: **implemented** — every table below exists in the
migration history, and `./scripts/db/db.sh drift` asserts the two agree.

Types below are written as plain DDL wording. There is no datamodel to mirror
any more, so where this used to say `@@index([userId])` or `enum X` it now says
what the database actually contains.

## Table list

| Table | Spec file | Purpose |
|---|---|---|
| `users` | `tables/users.md` | Buyer / seller / admin accounts |
| `seller_verifications` | `tables/seller_verifications.md` | Student ID/KTM verification + approval |
| `products` | `tables/products.md` | Second-hand catalog |
| `product_events` | `tables/product_events.md` | Impression/click analytics events |
| `conversations` | `tables/conversations.md` | COD chat room per product |
| `messages` | `tables/messages.md` | Chat bubbles (text/image/location) |
| `support_tickets` | `tables/support_tickets.md` | Support help tickets |
| `support_messages` | `tables/support_messages.md` | Support chat + internal notes |
| `reports` | `tables/reports.md` | Catalog fraud reports |
| `admins` | `tables/admins.md` | Dashboard admin accounts (email + password) |
| `password_resets` | `tables/password_resets.md` | 4-digit OTP password change via email |
| `notifications` | `tables/notifications.md` | In-app notification inbox |
| `notification_preferences` | `tables/notification_preferences.md` | Per-key opt-out toggles |
| `ai_conversations` | `tables/ai_conversations.md` | AI chat sessions (titled, resumable) |
| `ai_messages` | `tables/ai_messages.md` | AI chat messages (user / assistant / system) |
| `ai_models` | `tables/ai_models.md` | AI model registry (pricing in USD, enable/disable) |
| `tool_invocations` | `tables/tool_invocations.md` | AI tool-call log for the ops benchmark |
| `refresh_tokens` | `tables/refresh_tokens.md` | Session state that makes a session revocable |

## Enums

Every one of these is a native MariaDB `ENUM` column. The application writes the
members as bare strings and never imports a generated enum object.

| Column type | Members |
|---|---|
| `UserRole` | `BUYER \| SELLER \| ADMIN \| SUPER_ADMIN` |
| `VerificationStatus` | `PENDING \| APPROVED \| REJECTED` |
| `VerificationAction` | `NONE \| APPROVE \| REJECT` |
| `ProductStatus` | `ACTIVE \| SOLD \| ARCHIVED` |
| `ProductEventType` | `IMPRESSION \| CLICK` |
| `MessageType` | `TEXT \| IMAGE \| LOCATION \| SYSTEM` |
| `SupportTicketStatus` | `ACTIVE \| CLOSED` |
| `SupportTicketCategory` | `AKUN \| PRODUK \| CHAT \| VERIFIKASI \| LAPORAN \| LAINNYA` |
| `ReportCategory` | `PENIPUAN \| BARANG_PALSU \| BARANG_TIDAK_SESUAI \| HARGA_MENYESATKAN \| KONTEN_TIDAK_PANTAS \| SPAM \| LAINNYA` |
| `ReportStatus` | `PENDING \| IN_REVIEW \| RESOLVED \| REJECTED` |
| `ReportAction` | `NONE \| WARNING \| DELETE_PRODUCT \| BAN_USER` |
| `AiMessageRole` | `USER \| ASSISTANT \| SYSTEM` |
| `ToolInvocationStatus` | `SUCCESS \| FAILED \| TIMEOUT` |

## Table relations

```
users 1--0..1 seller_verifications
users 1--N products (as seller)
users 1--N conversations (as buyer / as seller)
conversations 1--N messages
products 1--N conversations (nullable, SetNull)
products 1--N product_events
users 1--N support_tickets (as reporter)
support_tickets 1--N support_messages
users 1--N reports (as reporter / reportedUser)
products 1--N reports (nullable, SetNull)
admins (standalone — dashboard session, no relations to other tables)
users 1--N password_resets (OTP tickets per user)
users 1--N notifications
users 1--N notification_preferences
users 1--N ai_conversations (AI chat sessions per user)
ai_conversations 1--N ai_messages
ai_models (standalone — referenced by `ai_messages.model` string, no FK)
refresh_tokens (standalone — points at `users` or `admins` via subjectType/subjectId, no FK)
```

### Columns that are deliberately *not* foreign keys

| Column | Why |
|---|---|
| `seller_verifications.reviewedBy`, `reports.reviewedBy` | The deciding admin is often an `admins` (dashboard) row, whose id namespace is disjoint from `users`. A `users` FK made the whole review path fail. |
| `product_events.viewerId` | Deleting a viewer must not erase the seller's historical numbers, and the viewer may be anonymous. |
| `tool_invocations.userId` | Same reason: an ops counter must outlive the account that generated it. |
| `reports.reportedUserId` / `reportedProductId` | Nullable, and `SetNull` so the report survives either target. |
| `refresh_tokens.subjectId` | A session belongs to an `admins` row *or* a `users` row, and the two namespaces are disjoint. A `users` FK would have made refresh impossible for every dashboard account. `subjectType` carries both the table and the token shape. |

## Display numbers (human-readable)

| Table | Field | Format | Generated in |
|---|---|---|---|
| `support_tickets` | `ticketNo` unique | `KSP-YYYYMMDD-XXXX` | service |
| `reports` | `reportNo` unique | `RPT-YYYYMMDD-XXXX` | service |

Both carry two random hex digits against a unique column, so the service retries
up to three times on a collision before failing.

## Primary keys

| Table | Primary key |
|---|---|
| `notification_preferences` | `(userId, key)` — composite, no surrogate id |
| everything else | `id` (`varchar(191)`, cuid2, generated by `src/ids.js`) |

## Global rules

1. Store passwords as `passwordHash`, never plain text.
2. `ktmImageUrl` is private — admin only, never include it in public product/chat
   responses. `src/selects.js` is the allow-list that enforces this.
3. Product `category` is still free text (blank) — TODO: become a `Category` FK.
4. Separate DB per env: `kosply_dev` / `kosply_staging` / `kosply_main`, plus
   `kosply_agent` under its own least-privilege role.
5. `price >= 0`, `stock >= 0`, latitude/longitude in range,
   `password_resets.attempts >= 0` and JSON validity of the three JSON columns
   are enforced by `docker/checks.sql` **as well as** the service layer. The
   database is the last line of defence: a future writer is not the service layer.
6. `boolean` columns are `tinyint(1)` and `json` columns are `longtext` — MariaDB
   has neither type. `src/cast.js` converts on read and write; nothing else may
   read these columns directly.
7. `updatedAt` is `NOT NULL` with no database default and is maintained by the
   statement builder. A write that omits it fails rather than silently going
   stale.