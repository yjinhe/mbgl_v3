import { PrismaClient } from '@prisma/client';
import { createSqliteSchema } from '../test/setup-db.js';
import { hashPassword } from './services/password.js';

process.env.DATABASE_URL ??= 'file:./dev.db';
const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='User'"
  );
  if (existing.length > 0) {
    console.log('Dev SQLite database already initialized');
    return;
  }
  await createSqliteSchema(prisma);
  const pharmacy = await prisma.pharmacy.create({ data: { name: '康宁大药房 · 中山路店', address: '中山路 128 号' } });
  const other = await prisma.pharmacy.create({ data: { name: '百姓缘药房 · 解放路店', address: '解放路 56 号' } });
  const owner = await prisma.pharmacyStaff.create({ data: { pharmacyId: pharmacy.id, username: 'kangning', passwordHash: await hashPassword('Kn@123456'), name: '王建国', role: 'owner' } });
  const staff = await prisma.pharmacyStaff.create({ data: { pharmacyId: pharmacy.id, username: 'kn_li', passwordHash: await hashPassword('Kn@123456'), name: '李雯', role: 'staff' } });
  await prisma.pharmacyStaff.create({ data: { pharmacyId: other.id, username: 'baixingyuan', passwordHash: await hashPassword('Bxy@123456'), name: '赵敏', role: 'owner' } });
  const invite = await prisma.inviteCode.create({ data: { pharmacyId: pharmacy.id, staffId: staff.id, code: 'KN23DEMO', expiresAt: new Date(Date.now() + 30 * 86400000) } });
  const user = await prisma.user.create({ data: { openid: 'mock_seed_demo', nickname: '微信用户_8462', sex: 'male' } });
  await prisma.pharmacyCustomer.create({ data: { pharmacyId: pharmacy.id, userId: user.id, inviteCodeId: invite.id } });
  await prisma.glucoseRecord.createMany({ data: [
    { userId: user.id, valueMmol: 6.1, period: 'fasting', measuredAt: new Date(), tags: '[]', note: '' },
    { userId: user.id, valueMmol: 8.2, period: 'after_breakfast', measuredAt: new Date(), tags: '[]', note: '燕麦 + 鸡蛋' }
  ] });
  await prisma.bpRecord.create({ data: { userId: user.id, sbp: 186, dbp: 112, pulse: 91, period: 'morning', measuredAt: new Date(), tags: '[]', note: '' } });
  await prisma.adminUser.create({ data: { username: 'admin', passwordHash: await hashPassword('Admin@123456') } });
  void owner;
  console.log('Initialized dev SQLite database');
}

main().finally(() => prisma.$disconnect());
