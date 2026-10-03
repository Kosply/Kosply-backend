-- The deciding admin may be an `admins` (dashboard) row, not a `users` row.
-- `admins.id` and `users.id` are disjoint cuid namespaces, so writing a
-- dashboard admin id into a `users(id)` FK raised P2003 and 500'd the whole
-- moderation path *after* enforcement side effects had already committed.
-- `reviewedBy` is retained as an opaque audit field (no referential link).
ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "reports_reviewedBy_fkey";
ALTER TABLE "seller_verifications" DROP CONSTRAINT IF EXISTS "seller_verifications_reviewedBy_fkey";
