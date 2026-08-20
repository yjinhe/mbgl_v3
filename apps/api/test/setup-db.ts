import type { PrismaClient } from '@prisma/client';

export async function createSqliteSchema(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
  const statements = [
    `CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "openid" TEXT NOT NULL UNIQUE,
      "miniOpenid" TEXT UNIQUE,
      "webOpenid" TEXT UNIQUE,
      "unionid" TEXT UNIQUE,
      "loginName" TEXT UNIQUE,
      "passwordHash" TEXT,
      "authVersion" INTEGER NOT NULL DEFAULT 0,
      "nickname" TEXT NOT NULL DEFAULT '微信用户',
      "avatarUrl" TEXT,
      "sex" TEXT,
      "unit" TEXT NOT NULL DEFAULT 'mmol',
      "fastingLow" DECIMAL NOT NULL DEFAULT 4.4,
      "fastingHigh" DECIMAL NOT NULL DEFAULT 7.0,
      "postMealHigh" DECIMAL NOT NULL DEFAULT 10.0,
      "deactivatedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX "User_loginName_key" ON "User"("loginName")`,
    `CREATE TABLE "GlucoseRecord" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "valueMmol" DECIMAL NOT NULL,
      "period" TEXT NOT NULL,
      "measuredAt" DATETIME NOT NULL,
      "tags" TEXT NOT NULL DEFAULT '[]',
      "note" TEXT NOT NULL DEFAULT '',
      "deletedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE "BpRecord" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "sbp" INTEGER NOT NULL,
      "dbp" INTEGER NOT NULL,
      "pulse" INTEGER,
      "period" TEXT NOT NULL,
      "measuredAt" DATETIME NOT NULL,
      "tags" TEXT NOT NULL DEFAULT '[]',
      "note" TEXT NOT NULL DEFAULT '',
      "deletedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE "LipidRecord" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "tc" DECIMAL,
      "tg" DECIMAL,
      "ldl" DECIMAL,
      "hdl" DECIMAL,
      "fasting" BOOLEAN NOT NULL DEFAULT true,
      "measuredAt" DATETIME NOT NULL,
      "note" TEXT NOT NULL DEFAULT '',
      "deletedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE "UricRecord" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "value" INTEGER NOT NULL,
      "fasting" BOOLEAN NOT NULL DEFAULT true,
      "measuredAt" DATETIME NOT NULL,
      "note" TEXT NOT NULL DEFAULT '',
      "deletedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE "DailySummary" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "date" TEXT NOT NULL,
      "avg" DECIMAL NOT NULL,
      "max" DECIMAL NOT NULL,
      "min" DECIMAL NOT NULL,
      "count" INTEGER NOT NULL,
      "okCount" INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX "DailySummary_userId_date_key" ON "DailySummary"("userId", "date")`,
    `CREATE TABLE "Pharmacy" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "address" TEXT NOT NULL DEFAULT '',
      "phone" TEXT NOT NULL DEFAULT '',
      "disabledAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE "PharmacyStaff" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "pharmacyId" TEXT NOT NULL,
      "username" TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "role" TEXT NOT NULL DEFAULT 'staff',
      "authVersion" INTEGER NOT NULL DEFAULT 0,
      "disabledAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE "InviteCode" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "pharmacyId" TEXT NOT NULL,
      "staffId" TEXT NOT NULL,
      "code" TEXT NOT NULL UNIQUE,
      "expiresAt" DATETIME NOT NULL,
      "disabledAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE "PharmacyCustomer" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "pharmacyId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "inviteCodeId" TEXT,
      "consentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "unboundAt" DATETIME
    )`,
    `CREATE UNIQUE INDEX "PharmacyCustomer_one_active_user" ON "PharmacyCustomer"("userId") WHERE "unboundAt" IS NULL`,
    `CREATE TABLE "FollowUp" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "pharmacyId" TEXT NOT NULL,
      "staffId" TEXT NOT NULL,
      "metric" TEXT NOT NULL,
      "recordId" TEXT NOT NULL,
      "note" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX "FollowUp_pharmacyId_metric_recordId_key" ON "FollowUp"("pharmacyId", "metric", "recordId")`,
    `CREATE TABLE "PharmacyAccessLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "pharmacyId" TEXT NOT NULL,
      "staffId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE "AdminUser" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "username" TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT NOT NULL,
      "authVersion" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ];
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
}
