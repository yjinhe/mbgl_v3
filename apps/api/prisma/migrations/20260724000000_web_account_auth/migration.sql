ALTER TABLE "User" ADD COLUMN "loginName" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "User_loginName_key" ON "User"("loginName");
