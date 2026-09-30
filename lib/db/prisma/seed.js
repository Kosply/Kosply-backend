/**
 * @title Kosply dev seed
 * @notice Inserts minimal dev data: buyer, verified seller, products.
 * @dev DEV ONLY (local/staging). Password hashes are plain SHA-256 markers,
 * @dev NOT real credentials — real auth hashes on register. Requires
 * @dev DATABASE_URL, run after `prisma migrate dev`.
 */
const crypto = require('node:crypto');
const prisma = require('../src/client');

const devHash = (label) => crypto.createHash('sha256').update(`dev-only:${label}`).digest('hex');

const run = async () => {
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
      ktmImageUrl: 'dev://ktm-placeholder',
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
    const admin = await prisma.admin.upsert({
      where: { email: process.env.ADMIN_SEED_EMAIL.toLowerCase() },
      update: {},
      create: {
        email: process.env.ADMIN_SEED_EMAIL.toLowerCase(),
        name: 'Dev Admin',
        passwordHash: await bcrypt.hash(process.env.ADMIN_SEED_PASSWORD, 10),
      },
    });
    console.log(`[seed] admin=${admin.id} (from ADMIN_SEED_EMAIL)`);
  }

  if (process.env.SUPERADMIN_SEED_EMAIL && process.env.SUPERADMIN_SEED_PASSWORD) {
    const bcrypt = require('bcryptjs');
    const root = await prisma.user.upsert({
      where: { email: process.env.SUPERADMIN_SEED_EMAIL.toLowerCase() },
      update: {},
      create: {
        email: process.env.SUPERADMIN_SEED_EMAIL.toLowerCase(),
        username: 'root',
        name: 'Super Admin',
        passwordHash: await bcrypt.hash(process.env.SUPERADMIN_SEED_PASSWORD, 10),
        universitas: 'Kosply',
        programStudi: 'Ops',
        role: 'SUPER_ADMIN',
      },
    });
    console.log(`[seed] super-admin=${root.id} (from SUPERADMIN_SEED_EMAIL)`);
  }
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
