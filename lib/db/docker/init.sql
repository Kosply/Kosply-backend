-- @title Kosply Postgres init
-- @notice Membuat database per-env agar staging tidak mengotori main.
-- @dev Dijalankan otomatis oleh docker-entrypoint-initdb.d saat volume masih kosong.
SELECT 'CREATE DATABASE kosply_staging' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kosply_staging')\gexec
SELECT 'CREATE DATABASE kosply_main' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kosply_main')\gexec
