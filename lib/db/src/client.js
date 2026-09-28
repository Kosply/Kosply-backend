/**
 * @title Kosply Prisma client singleton
 * @notice Satu PrismaClient untuk seluruh proses Node (hindari exhaust koneksi di PM2 cluster).
 * @dev Import dari server via `require('../../db/src/client')`.
 * @dev Butuh env DATABASE_URL, lihat lib/db/.env.example.
 */
const { PrismaClient } = require('@prisma/client');

/**
 * @notice Global cache agar --watch / hot-reload tidak bikin client baru tiap reload.
 * @dev Di production (PM2 cluster) tiap worker tetap punya 1 instance sendiri — itu yang diinginkan.
 */
const globalForPrisma = globalThis;

/**
 * @notice Ambil atau buat PrismaClient singleton.
 * @return {PrismaClient} Client yang siap dipakai (`prisma.user`, `prisma.product`, ...).
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
