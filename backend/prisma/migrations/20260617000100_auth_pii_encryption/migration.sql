-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emailHash" TEXT NOT NULL,
    "emailEncrypted" TEXT NOT NULL,
    "nameEncrypted" TEXT,
    "passwordHash" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash");

-- AlterTable
ALTER TABLE "EmergencyEvent"
ADD COLUMN "userId" TEXT,
ADD COLUMN "latitudeEncrypted" TEXT,
ADD COLUMN "longitudeEncrypted" TEXT;

-- AlterTable
ALTER TABLE "TrustedContact"
ADD COLUMN "userId" TEXT,
ADD COLUMN "isPriority" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Recording"
ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "EmergencyEvent_userId_idx" ON "EmergencyEvent"("userId");

-- CreateIndex
CREATE INDEX "TrustedContact_userId_idx" ON "TrustedContact"("userId");

-- CreateIndex
CREATE INDEX "Recording_userId_idx" ON "Recording"("userId");

-- AddForeignKey
ALTER TABLE "EmergencyEvent"
ADD CONSTRAINT "EmergencyEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedContact"
ADD CONSTRAINT "TrustedContact_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording"
ADD CONSTRAINT "Recording_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PrivateData" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "dataEncrypted" TEXT NOT NULL,

    CONSTRAINT "PrivateData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivateData_userId_idx" ON "PrivateData"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateData_userId_key_key" ON "PrivateData"("userId", "key");

-- AddForeignKey
ALTER TABLE "PrivateData"
ADD CONSTRAINT "PrivateData_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
