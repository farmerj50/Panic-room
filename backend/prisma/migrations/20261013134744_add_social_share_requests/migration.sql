-- CreateTable
CREATE TABLE "SocialShareRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emergencyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialShareRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialShareRequest_createdAt_idx" ON "SocialShareRequest"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialShareRequest_userId_requestId_key" ON "SocialShareRequest"("userId", "requestId");

-- AddForeignKey
ALTER TABLE "SocialShareRequest" ADD CONSTRAINT "SocialShareRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialShareRequest" ADD CONSTRAINT "SocialShareRequest_emergencyId_fkey" FOREIGN KEY ("emergencyId") REFERENCES "EmergencyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
