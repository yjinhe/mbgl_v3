-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "openid" TEXT NOT NULL,
    "nickname" TEXT NOT NULL DEFAULT '微信用户',
    "sex" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'mmol',
    "fastingLow" DECIMAL NOT NULL DEFAULT 4.4,
    "fastingHigh" DECIMAL NOT NULL DEFAULT 7.0,
    "postMealHigh" DECIMAL NOT NULL DEFAULT 10.0,
    "deactivatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "GlucoseRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "valueMmol" DECIMAL NOT NULL,
    "period" TEXT NOT NULL,
    "measuredAt" DATETIME NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL DEFAULT '',
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GlucoseRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "BpRecord" (
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BpRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "LipidRecord" (
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LipidRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "UricRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "fasting" BOOLEAN NOT NULL DEFAULT true,
    "measuredAt" DATETIME NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UricRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "DailySummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "avg" DECIMAL NOT NULL,
    "max" DECIMAL NOT NULL,
    "min" DECIMAL NOT NULL,
    "count" INTEGER NOT NULL,
    "okCount" INTEGER NOT NULL,
    CONSTRAINT "DailySummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Pharmacy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PharmacyStaff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pharmacyId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'staff',
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PharmacyStaff_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pharmacyId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InviteCode_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PharmacyCustomer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pharmacyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inviteCodeId" TEXT,
    "consentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unboundAt" DATETIME,
    CONSTRAINT "PharmacyCustomer_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PharmacyCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PharmacyCustomer_inviteCodeId_fkey" FOREIGN KEY ("inviteCodeId") REFERENCES "InviteCode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pharmacyId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PharmacyAccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pharmacyId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "User_openid_key" ON "User"("openid");
CREATE INDEX "GlucoseRecord_userId_measuredAt_idx" ON "GlucoseRecord"("userId", "measuredAt");
CREATE INDEX "GlucoseRecord_userId_deletedAt_idx" ON "GlucoseRecord"("userId", "deletedAt");
CREATE INDEX "BpRecord_userId_measuredAt_idx" ON "BpRecord"("userId", "measuredAt");
CREATE INDEX "LipidRecord_userId_measuredAt_idx" ON "LipidRecord"("userId", "measuredAt");
CREATE INDEX "UricRecord_userId_measuredAt_idx" ON "UricRecord"("userId", "measuredAt");
CREATE UNIQUE INDEX "DailySummary_userId_date_key" ON "DailySummary"("userId", "date");
CREATE UNIQUE INDEX "PharmacyStaff_username_key" ON "PharmacyStaff"("username");
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");
CREATE INDEX "PharmacyCustomer_pharmacyId_unboundAt_idx" ON "PharmacyCustomer"("pharmacyId", "unboundAt");
CREATE INDEX "PharmacyCustomer_userId_unboundAt_idx" ON "PharmacyCustomer"("userId", "unboundAt");
CREATE UNIQUE INDEX "FollowUp_pharmacyId_metric_recordId_key" ON "FollowUp"("pharmacyId", "metric", "recordId");
CREATE INDEX "PharmacyAccessLog_pharmacyId_createdAt_idx" ON "PharmacyAccessLog"("pharmacyId", "createdAt");
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");
