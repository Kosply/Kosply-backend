-- Data-integrity backstops, applied AFTER `prisma migrate deploy`.
--
-- Run it per database:  psql -d <db> -f lib/db/docker/checks.sql
-- (or let `scripts/server.sh` do it, which is idempotent).
--
-- These ranges are validated in the service layer, but `psql`, Prisma Studio
-- and any future writer are not the service layer, and a negative price is a
-- straightforward marketplace fraud vector. The database is the last line of
-- defence.
--
-- Note: a previous attempt looped over database names with
-- `format('ALTER TABLE %I.products ...')`. `%I` quotes an IDENTIFIER, so that
-- produced `ALTER TABLE kosply_main.products`, which Postgres reads as
-- schema-qualified and rejects with `schema "kosply_main" does not exist` —
-- i.e. the constraints silently never existed. Cross-database DDL is not a
-- thing in Postgres; this file is meant to be run once per database.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_price_nonneg'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_price_nonneg CHECK (price >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_nonneg'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_stock_nonneg CHECK (stock >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_lat_range'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_lat_range
      CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_lng_range'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_lng_range
      CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'password_resets_attempts_nonneg'
  ) THEN
    ALTER TABLE password_resets ADD CONSTRAINT password_resets_attempts_nonneg
      CHECK (attempts >= 0);
  END IF;
END
$$;
