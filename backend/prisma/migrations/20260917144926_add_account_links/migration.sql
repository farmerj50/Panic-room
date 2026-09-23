-- CreateTable
CREATE TABLE "AccountLink" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerUserId" TEXT NOT NULL,
    "linkedUserId" TEXT,
    "relationshipType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "permissions" JSONB NOT NULL DEFAULT '{"emergencyAlerts": true, "liveLocationDuringEmergency": true, "backgroundLocation": false}',
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByRole" TEXT,

    CONSTRAINT "AccountLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountLink_ownerUserId_idx" ON "AccountLink"("ownerUserId");

-- CreateIndex
CREATE INDEX "AccountLink_linkedUserId_idx" ON "AccountLink"("linkedUserId");

-- CreateIndex
CREATE INDEX "AccountLink_codeHash_idx" ON "AccountLink"("codeHash");

-- AddForeignKey
ALTER TABLE "AccountLink" ADD CONSTRAINT "AccountLink_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLink" ADD CONSTRAINT "AccountLink_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
