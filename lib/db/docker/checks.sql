-- Data-integrity backstops, applied AFTER `prisma migrate deploy`.
--
-- Run it per database:  npx prisma db execute --file lib/db/docker/checks.sql \
--                          --schema schema/schema.db (from lib/db)
-- (or let `scripts/db/db.sh deploy` / `scripts/server.sh` do it, which is
-- idempotent).
--
-- These ranges are validated in the service layer, but Prisma Studio and any
-- future writer are not the service layer, and a negative price is a
-- straightforward marketplace fraud vector. The database is the last line of
-- defence.
--
-- MariaDB has no `DO $$ ... $$` blocks (those are PostgreSQL/plpgsql), and the
-- file must stay plain SQL: `prisma db execute` has no DELIMITER handling, so
-- no stored procedures either. Each constraint uses the classic MariaDB
-- idempotent-DDL pattern instead:
--
--   SET @ddl := IF(<constraint missing>, '<ALTER ...>', 'SELECT 1');
--   PREPARE stmt FROM @ddl;  EXECUTE stmt;  DEALLOCATE PREPARE stmt;
--
-- The guard reads information_schema.TABLE_CONSTRAINTS (present since MariaDB
-- 10.2, alongside CHECK constraint support itself). Constraints live outside
-- the Prisma migrations on purpose: they need the tables to exist first.

-- price/stock must be non-negative: a negative price is marketplace fraud.
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'products'
      AND CONSTRAINT_NAME = 'products_price_nonneg') = 0,
  'ALTER TABLE products ADD CONSTRAINT products_price_nonneg CHECK (price >= 0)',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'products'
      AND CONSTRAINT_NAME = 'products_stock_nonneg') = 0,
  'ALTER TABLE products ADD CONSTRAINT products_stock_nonneg CHECK (stock >= 0)',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- lat/lng bounds: coordinates outside these ranges break map rendering.
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'products'
      AND CONSTRAINT_NAME = 'products_lat_range') = 0,
  'ALTER TABLE products ADD CONSTRAINT products_lat_range
     CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90))',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'products'
      AND CONSTRAINT_NAME = 'products_lng_range') = 0,
  'ALTER TABLE products ADD CONSTRAINT products_lng_range
     CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180))',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- OTP resend/lock counter must not go negative.
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'password_resets'
      AND CONSTRAINT_NAME = 'password_resets_attempts_nonneg') = 0,
  'ALTER TABLE password_resets ADD CONSTRAINT password_resets_attempts_nonneg
     CHECK (attempts >= 0)',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- The Json columns are LONGTEXT (MariaDB's JSON is a LONGTEXT alias, and the
-- migrations say LONGTEXT so they agree with the datamodel). MariaDB would
-- have added the json_valid() CHECK itself had the columns been declared JSON,
-- so add it explicitly: the Prisma Client serialises them, but Prisma Studio,
-- a future raw-SQL writer or a hand-edited row must not be able to store
-- unparseable text in a column the server then hands back as JSON.
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'products'
      AND CONSTRAINT_NAME = 'products_imageurls_json') = 0,
  'ALTER TABLE products ADD CONSTRAINT products_imageurls_json
     CHECK (JSON_VALID(imageUrls))',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'reports'
      AND CONSTRAINT_NAME = 'reports_evidenceurls_json') = 0,
  'ALTER TABLE reports ADD CONSTRAINT reports_evidenceurls_json
     CHECK (JSON_VALID(evidenceUrls))',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'notifications'
      AND CONSTRAINT_NAME = 'notifications_data_json') = 0,
  'ALTER TABLE notifications ADD CONSTRAINT notifications_data_json
     CHECK (data IS NULL OR JSON_VALID(data))',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
