import { PrismaClient } from '@prisma/client';
import { hashPassword, isStrongPassword } from '../src/services/password.js';

const prisma = new PrismaClient();

async function main() {
  const username = (process.env.ADMIN_INIT_USERNAME || 'admin').trim();
  const password = process.env.ADMIN_INIT_PASSWORD || '';
  if (!username) throw new Error('ADMIN_INIT_USERNAME is required');
  if (!isStrongPassword(password)) {
    throw new Error('ADMIN_INIT_PASSWORD must be 12+ characters and include upper, lower, number, and symbol');
  }

  const existing = await prisma.adminUser.findUnique({ where: { username } });
  if (existing) {
    console.log(`Admin ${username} already exists; no changes made`);
    return;
  }

  await prisma.adminUser.create({
    data: { username, passwordHash: await hashPassword(password) }
  });
  console.log(`Created admin ${username}`);
}

main().finally(async () => {
  await prisma.$disconnect();
});
