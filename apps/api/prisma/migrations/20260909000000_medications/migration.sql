ALTER TABLE "ReminderLog" ADD COLUMN "slot" TEXT;

CREATE TABLE "Medication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "times" TEXT NOT NULL,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Medication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MedicationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MedicationLog_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Medication_userId_archivedAt_idx" ON "Medication"("userId", "archivedAt");

CREATE UNIQUE INDEX "MedicationLog_medicationId_day_slot_key" ON "MedicationLog"("medicationId", "day", "slot");

CREATE INDEX "MedicationLog_userId_day_idx" ON "MedicationLog"("userId", "day");
