-- AlterTable
ALTER TABLE "User" ADD COLUMN     "googleSubHash" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AccountDeletionChallenge" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AccountDeletionChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountDeletionChallenge_userId_idx" ON "AccountDeletionChallenge"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSubHash_key" ON "User"("googleSubHash");

-- AddForeignKey
ALTER TABLE "AccountDeletionChallenge" ADD CONSTRAINT "AccountDeletionChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

