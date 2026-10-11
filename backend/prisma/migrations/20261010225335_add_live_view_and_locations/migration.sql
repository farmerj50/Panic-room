-- AlterTable
ALTER TABLE "EmergencyEvent" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "locationsThinned" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EmergencyLocation" (
    "id" TEXT NOT NULL,
    "emergencyId" TEXT NOT NULL,
    "latitudeEncrypted" TEXT NOT NULL,
    "longitudeEncrypted" TEXT NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveViewLink" (
    "id" TEXT NOT NULL,
    "emergencyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "phoneHash" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "hardExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveViewLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyLocation_emergencyId_recordedAt_key" ON "EmergencyLocation"("emergencyId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveViewLink_tokenHash_key" ON "LiveViewLink"("tokenHash");

-- CreateIndex
CREATE INDEX "LiveViewLink_userId_idx" ON "LiveViewLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveViewLink_emergencyId_contactId_key" ON "LiveViewLink"("emergencyId", "contactId");

-- AddForeignKey
ALTER TABLE "EmergencyLocation" ADD CONSTRAINT "EmergencyLocation_emergencyId_fkey" FOREIGN KEY ("emergencyId") REFERENCES "EmergencyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveViewLink" ADD CONSTRAINT "LiveViewLink_emergencyId_fkey" FOREIGN KEY ("emergencyId") REFERENCES "EmergencyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveViewLink" ADD CONSTRAINT "LiveViewLink_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "TrustedContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveViewLink" ADD CONSTRAINT "LiveViewLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
