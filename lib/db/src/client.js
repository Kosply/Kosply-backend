/**
 * @title Kosply Prisma client singleton
 * @notice One PrismaClient for the whole Node process (avoids exhausting connections in PM2 cluster).
 * @dev Import from the server via `require('../../db/src/client')`.
 * @dev Needs env DATABASE_URL, see lib/db/.env.example.
 */
const { PrismaClient } = require('@prisma/client');

/**
 * @notice Global cache so --watch / hot-reload does not create a new client per reload.
 * @dev In production (PM2 cluster) each worker still holds its own instance — that is intended.
 */
const globalForPrisma = globalThis;

/**
 * @notice Get or create the PrismaClient singleton.
 * @return {PrismaClient} Ready-to-use client (`prisma.user`, `prisma.product`, ...).
 */
function getPrisma() {
  if (!globalForPrisma.__kosplyPrisma) {
    globalForPrisma.__kosplyPrisma = new PrismaClient();
  }
  return globalForPrisma.__kosplyPrisma;
}

const prisma = getPrisma();

module.exports = prisma;
module.exports.prisma = prisma;
