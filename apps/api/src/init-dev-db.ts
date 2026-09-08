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
    await ensureDevSchemaUpgrades();
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
  const user = await prisma.user.create({
    data: {
      openid: 'mock_seed_demo',
      loginName: 'demo',
      passwordHash: await hashPassword('Demo@1234567'),
      nickname: '微信用户_8462',
      sex: 'male'
    }
  });
  await prisma.pharmacyCustomer.create({ data: { pharmacyId: pharmacy.id, userId: user.id, inviteCodeId: invite.id } });
  await prisma.glucoseRecord.createMany({ data: [
    { userId: user.id, valueMmol: 6.1, period: 'fasting', measuredAt: new Date(), tags: '[]', note: '' },
    { userId: user.id, valueMmol: 8.2, period: 'after_breakfast', measuredAt: new Date(), tags: '[]', note: '燕麦 + 鸡蛋' }
  ] });
  await prisma.bpRecord.create({ data: { userId: user.id, sbp: 186, dbp: 112, pulse: 91, period: 'morning', measuredAt: new Date(), tags: '[]', note: '' } });
  await prisma.adminUser.create({ data: { username: 'admin', passwordHash: await hashPassword('Admin@123456') } });
  await ensureDevSchemaUpgrades();
  void owner;
  console.log('Initialized dev SQLite database');
}

async function ensureDevSchemaUpgrades() {
  const userColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("User")');
  for (const column of ['miniOpenid', 'webOpenid', 'unionid']) {
    if (!userColumns.some((item) => item.name === column)) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "${column}" TEXT`);
    }
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_${column}_key" ON "User"("${column}")`);
  }
  if (!userColumns.some((column) => column.name === 'loginName')) {
    await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN "loginName" TEXT');
  }
  if (!userColumns.some((column) => column.name === 'passwordHash')) {
    await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT');
  }
  if (!userColumns.some((column) => column.name === 'authVersion')) {
    await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0');
  }
  if (!userColumns.some((column) => column.name === 'avatarUrl')) {
    await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT');
  }
  if (!userColumns.some((column) => column.name === 'adminNote')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "adminNote" TEXT NOT NULL DEFAULT ''`);
  }
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "RecordSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "key" TEXT NOT NULL,
    "metric" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "recordId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`);
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "RecordSubmission_userId_key_key" ON "RecordSubmission"("userId", "key")');
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ReminderPlan" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "metric" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false, "time" TEXT NOT NULL, "period" TEXT,
    "quota" INTEGER NOT NULL DEFAULT 0, "lastSentDay" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`);
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "ReminderPlan_userId_metric_key" ON "ReminderPlan"("userId", "metric")');
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ReminderLog" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "metric" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL, "scheduledDay" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "ok" BOOLEAN NOT NULL,
    "errcode" INTEGER, "errmsg" TEXT
  )`);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ReminderLog_userId_scheduledDay_idx" ON "ReminderLog"("userId", "scheduledDay")');
  const reminderLogColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("ReminderLog")');
  if (!reminderLogColumns.some((column) => column.name === 'slot')) {
    await prisma.$executeRawUnsafe('ALTER TABLE "ReminderLog" ADD COLUMN "slot" TEXT');
  }
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Medication" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "name" TEXT NOT NULL, "times" TEXT NOT NULL,
    "archivedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Medication_userId_archivedAt_idx" ON "Medication"("userId", "archivedAt")');
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MedicationLog" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "medicationId" TEXT NOT NULL,
    "day" TEXT NOT NULL, "slot" TEXT NOT NULL, "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`);
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "MedicationLog_medicationId_day_slot_key" ON "MedicationLog"("medicationId", "day", "slot")');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "MedicationLog_userId_day_idx" ON "MedicationLog"("userId", "day")');
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "User_loginName_key" ON "User"("loginName")');
  await migrateLegacyDemoIdentity();
  await ensureDevWebAccount();
  const staffColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("PharmacyStaff")');
  if (!staffColumns.some((column) => column.name === 'authVersion')) {
    await prisma.$executeRawUnsafe('ALTER TABLE "PharmacyStaff" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0');
  }
  const adminColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("AdminUser")');
  if (!adminColumns.some((column) => column.name === 'authVersion')) {
    await prisma.$executeRawUnsafe('ALTER TABLE "AdminUser" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0');
  }
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "PharmacyCustomer_one_active_user" ON "PharmacyCustomer"("userId") WHERE "unboundAt" IS NULL'
  );
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
}

async function ensureDevWebAccount() {
  const demo = await prisma.user.findUnique({ where: { openid: 'mock_seed_demo' } });
  if (!demo || demo.deactivatedAt || demo.loginName || await prisma.user.findUnique({ where: { loginName: 'demo' } })) return;
  await prisma.user.update({
    where: { id: demo.id },
    data: { loginName: 'demo', passwordHash: await hashPassword('Demo@1234567') }
  });
}

async function migrateLegacyDemoIdentity() {
  const legacy = await prisma.user.findUnique({ where: { openid: 'seed_demo' } });
  if (!legacy || legacy.deactivatedAt) return;
  const current = await prisma.user.findUnique({ where: { openid: 'mock_seed_demo' } });
  if (!current) {
    await prisma.user.update({
      where: { id: legacy.id },
      data: { openid: 'mock_seed_demo', miniOpenid: 'mock_seed_demo', unionid: 'mock:seed_demo' }
    });
    return;
  }
  if (current.deactivatedAt) {
    console.warn('Legacy demo identity was not merged because mock_seed_demo is deactivated');
    return;
  }

  await prisma.$transaction(async (tx) => {
    const currentActiveBinding = await tx.pharmacyCustomer.findFirst({ where: { userId: current.id, unboundAt: null } });
    if (currentActiveBinding) {
      await tx.pharmacyCustomer.updateMany({
        where: { userId: legacy.id, unboundAt: null },
        data: { unboundAt: new Date() }
      });
    }
    const legacySummaryDates = (await tx.dailySummary.findMany({
      where: { userId: legacy.id },
      select: { date: true }
    })).map((item) => item.date);
    if (legacySummaryDates.length > 0) {
      await tx.dailySummary.deleteMany({ where: { userId: current.id, date: { in: legacySummaryDates } } });
    }
    await tx.dailySummary.updateMany({ where: { userId: legacy.id }, data: { userId: current.id } });
    await tx.glucoseRecord.updateMany({ where: { userId: legacy.id }, data: { userId: current.id } });
    await tx.bpRecord.updateMany({ where: { userId: legacy.id }, data: { userId: current.id } });
    await tx.lipidRecord.updateMany({ where: { userId: legacy.id }, data: { userId: current.id } });
    await tx.uricRecord.updateMany({ where: { userId: legacy.id }, data: { userId: current.id } });
    await tx.pharmacyCustomer.updateMany({ where: { userId: legacy.id }, data: { userId: current.id } });
    await tx.pharmacyAccessLog.updateMany({ where: { userId: legacy.id }, data: { userId: current.id } });
    await tx.user.update({
      where: { id: current.id },
      data: {
        miniOpenid: 'mock_seed_demo',
        unionid: 'mock:seed_demo',
        nickname: legacy.nickname,
        sex: legacy.sex,
        unit: legacy.unit,
        fastingLow: legacy.fastingLow,
        fastingHigh: legacy.fastingHigh,
        postMealHigh: legacy.postMealHigh
      }
    });
    await tx.user.delete({ where: { id: legacy.id } });
  });
  console.log('Merged legacy seed_demo data into mock_seed_demo');
}

main().finally(() => prisma.$disconnect());
