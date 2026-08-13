-- AlterTable
ALTER TABLE "EmergencyEvent" ADD COLUMN     "notificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notificationError" TEXT;

-- AlterTable
ALTER TABLE "TrustedContact" ADD COLUMN     "phoneHash" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneEncrypted" TEXT,
ADD COLUMN     "phoneHash" TEXT,
ADD COLUMN     "publicKey" TEXT;

-- CreateTable
CREATE TABLE "CovertMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "senderId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "protocolVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CovertMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByTokenHash" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CovertMessage_recipientUserId_idx" ON "CovertMessage"("recipientUserId");

-- CreateIndex
CREATE INDEX "CovertMessage_senderId_idx" ON "CovertMessage"("senderId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "TrustedContact_phoneHash_idx" ON "TrustedContact"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");

-- AddForeignKey
ALTER TABLE "CovertMessage" ADD CONSTRAINT "CovertMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CovertMessage" ADD CONSTRAINT "CovertMessage_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

