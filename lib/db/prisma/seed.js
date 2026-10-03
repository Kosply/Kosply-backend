/**
 * @title Kosply dev seed
 * @notice Inserts minimal dev data: buyer, verified seller, products.
 * @dev DEV ONLY. Refuses to run against production or against a database whose
 * @dev name is not an explicit dev/test target. It previously had no guard at
 * @dev all, so `npm run seed` with a production DATABASE_URL published three
 * @dev ACTIVE listings plus a real SUPER_ADMIN into the live marketplace.
 * @dev The marketplace fixtures use plain SHA-256 markers, NOT real credentials
 * @dev (bcrypt.compare against them always fails, so they are not loginable).
 * @dev Bootstrap admin passwords DO come from the environment, are length
 * @dev checked, and now genuinely rotate on re-run.
 */
const crypto = require('node:crypto');
const prisma = require('../src/client');

/** @dev Only these database names may be seeded. */
const ALLOWED_DATABASES = ['kosply_dev', 'kosply_test', 'test', 'postgres'];
const MIN_ADMIN_PASSWORD = 12;

/**
 * @notice Refuse to seed anything that is not obviously a dev database.
 * @return {string} The database name.
 * @throws {Error} When the target looks like production.
 */
const assertDevDatabase = () => {
  const url = process.env.DATABASE_URL || '';
  let name = '';
  try {
    name = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('DATABASE_URL is missing or unparseable; refusing to seed');
  }
  // NODE_ENV=production is the hard gate: no override flag bypasses it, so a
  // stray env var in a deploy script cannot publish fixtures into production.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to seed with NODE_ENV=production');
  }
  if (process.env.ALLOW_PRODUCTION_SEED === '1') {
    console.warn(`[seed] ALLOW_PRODUCTION_SEED=1 set, seeding ${name} anyway`);
    return name;
  }
  if (!ALLOWED_DATABASES.includes(name)) {
    throw new Error(
      `refusing to seed database "${name}" (allowed: ${ALLOWED_DATABASES.join(', ')}). ` +
        'Set ALLOW_PRODUCTION_SEED=1 if this really is a throwaway database.'
    );
  }
  return name;
};

/**
 * @notice Derive a username from an email local part, uniquely.
 * @dev The seed hardcoded `username: 'root'`, so seeding a second super admin
 * @dev aborted the whole run on a unique violation *after* it had already
 * @dev committed the dev fixtures.
 * @param {string} email Bootstrap admin email.
 * @param {string} role Role slug, used as a suffix.
 * @return {Promise<string>} A free username.
 */
const uniqueUsername = async (email, role) => {
  const base = (email.split('@')[0] || 'admin').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 20) || 'admin';
  for (let i = 0; i < 5; i += 1) {
    const candidate = i === 0 ? base : `${base}-${role}-${i}`;
    const taken = await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${role}-${crypto.randomBytes(3).toString('hex')}`;
};

const devHash = (label) => crypto.createHash('sha256').update(`dev-only:${label}`).digest('hex');

const run = async () => {
  const database = assertDevDatabase();
  console.log(`[seed] target database = ${database}`);

  const buyer = await prisma.user.upsert({
    where: { email: 'buyer.dev@kosply.test' },
    update: {},
    create: {
      email: 'buyer.dev@kosply.test',
      username: 'buyerdev',
      name: 'Buyer Dev',
      passwordHash: devHash('buyer'),
      universitas: 'Univ Dev',
      programStudi: 'Prodi Dev',
      role: 'BUYER',
    },
  });

  const seller = await prisma.user.upsert({
    where: { email: 'seller.dev@kosply.test' },
    update: {},
    create: {
      email: 'seller.dev@kosply.test',
      username: 'sellerdev',
      name: 'Seller Dev',
      passwordHash: devHash('seller'),
      universitas: 'Univ Dev',
      programStudi: 'Prodi Dev',
      role: 'SELLER',
      bio: 'Lapak second kampus: elektronik dan buku.',
    },
  });

  await prisma.sellerVerification.upsert({
    where: { userId: seller.id },
    update: {},
    create: {
      userId: seller.id,
      namaLengkap: 'Seller Dev',
      nim: 'DEV123456',
      universitas: 'Univ Dev',
      programStudi: 'Prodi Dev',
      ktmImageUrl: 'https://cdn.kosply.test/dev-ktm-placeholder.png',
      status: 'APPROVED',
      isActive: true,
      action: 'APPROVE',
    },
  });

  const products = [
    { title: 'Kipas angin second', description: 'Masih dingin, minus dus.', price: 150000, stock: 2 },
    { title: 'Buku kalkulus bekas', description: 'Coretan dikit bab 1.', price: 45000, stock: 1 },
    { title: 'Meja lipat kos', description: 'Kokoh, lipat normal.', price: 120000, stock: 1 },
  ];
  for (const [i, p] of products.entries()) {
    await prisma.product.upsert({
      where: { id: `dev-product-${i + 1}` },
      update: {},
      create: { id: `dev-product-${i + 1}`, sellerId: seller.id, ...p },
    });
  }

  console.log(`[seed] buyer=${buyer.id} seller=${seller.id} products=3`);

  if (process.env.ADMIN_SEED_EMAIL && process.env.ADMIN_SEED_PASSWORD) {
    const bcrypt = require('bcryptjs');
    const password = process.env.ADMIN_SEED_PASSWORD;
    if (password.length < MIN_ADMIN_PASSWORD) {
      throw new Error(`ADMIN_SEED_PASSWORD must be at least ${MIN_ADMIN_PASSWORD} characters`);
    }
    const email = process.env.ADMIN_SEED_EMAIL.toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);
    // `update: {}` meant re-seeding with a new password silently kept the old
    // one, so a leaked dashboard credential could never be rotated.
    const admin = await prisma.admin.upsert({
      where: { email },
      update: { passwordHash },
      create: { email, name: 'Dev Admin', passwordHash },
    });
    console.log(`[seed] admin=${admin.id} (from ADMIN_SEED_EMAIL, password rotated)`);
  }

  if (process.env.SUPERADMIN_SEED_EMAIL && process.env.SUPERADMIN_SEED_PASSWORD) {
    const bcrypt = require('bcryptjs');
    const email = process.env.SUPERADMIN_SEED_EMAIL.toLowerCase();
    const password = process.env.SUPERADMIN_SEED_PASSWORD;
    if (password.length < MIN_ADMIN_PASSWORD) {
      throw new Error(`SUPERADMIN_SEED_PASSWORD must be at least ${MIN_ADMIN_PASSWORD} characters`);
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, username: true } });
    const root = await prisma.user.upsert({
      where: { email },
      update: { passwordHash },
      create: {
        email,
        username: existing ? existing.username : await uniqueUsername(email, 'root'),
        name: 'Super Admin',
        passwordHash,
        universitas: 'Kosply',
        programStudi: 'Ops',
        role: 'SUPER_ADMIN',
      },
    });
    // Keep the dashboard store in sync, so `/api/admin/login` accepts the same
    // credentials that `POST /api/admin/users` provisions.
    await prisma.admin.upsert({
      where: { email },
      update: { passwordHash },
      create: { email, name: 'Super Admin', passwordHash },
    });
    console.log(`[seed] super-admin=${root.id} (from SUPERADMIN_SEED_EMAIL, password rotated)`);
  }
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
