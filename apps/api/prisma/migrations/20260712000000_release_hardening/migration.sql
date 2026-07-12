-- Fail closed if legacy data contains more than one active pharmacy binding per user.
CREATE UNIQUE INDEX "PharmacyCustomer_one_active_user"
ON "PharmacyCustomer"("userId")
WHERE "unboundAt" IS NULL;

ALTER TABLE "User" ADD COLUMN "miniOpenid" TEXT;
ALTER TABLE "User" ADD COLUMN "webOpenid" TEXT;
ALTER TABLE "User" ADD COLUMN "unionid" TEXT;
CREATE UNIQUE INDEX "User_miniOpenid_key" ON "User"("miniOpenid");
CREATE UNIQUE INDEX "User_webOpenid_key" ON "User"("webOpenid");
CREATE UNIQUE INDEX "User_unionid_key" ON "User"("unionid");

ALTER TABLE "PharmacyStaff" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AdminUser" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
