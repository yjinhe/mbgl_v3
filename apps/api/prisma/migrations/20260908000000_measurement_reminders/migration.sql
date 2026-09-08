CREATE TABLE "ReminderPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "time" TEXT NOT NULL,
    "period" TEXT,
    "quota" INTEGER NOT NULL DEFAULT 0,
    "lastSentDay" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReminderPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "scheduledDay" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "errcode" INTEGER,
    "errmsg" TEXT
);

CREATE UNIQUE INDEX "ReminderPlan_userId_metric_key" ON "ReminderPlan"("userId", "metric");

CREATE INDEX "ReminderLog_userId_scheduledDay_idx" ON "ReminderLog"("userId", "scheduledDay");
