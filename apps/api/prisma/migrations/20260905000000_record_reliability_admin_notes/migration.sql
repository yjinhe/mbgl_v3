ALTER TABLE "User" ADD COLUMN "adminNote" TEXT NOT NULL DEFAULT '';

CREATE TABLE "RecordSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "recordId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RecordSubmission_userId_key_key" ON "RecordSubmission"("userId", "key");
