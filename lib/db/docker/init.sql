-- @title Kosply Postgres init
-- @notice Creates one database per env so staging never pollutes main.
-- @dev Runs automatically via docker-entrypoint-initdb.d while the volume is still empty.
SELECT 'CREATE DATABASE kosply_staging' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kosply_staging')\gexec
SELECT 'CREATE DATABASE kosply_main' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kosply_main')\gexec
