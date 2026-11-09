-- Phone recovery tracking (additive; existing rows keep NULLs).

-- AlterTable
ALTER TABLE "EmergencyEvent" ADD COLUMN     "recoveryStatus" TEXT,
ADD COLUMN     "recoveryConsentAt" TIMESTAMP(3),
ADD COLUMN     "recoveryStartedAt" TIMESTAMP(3),
ADD COLUMN     "recoveryExpiresAt" TIMESTAMP(3),
ADD COLUMN     "recoveryEndedAt" TIMESTAMP(3),
ADD COLUMN     "recoveryEndReason" TEXT;

-- AlterTable
ALTER TABLE "EmergencyLocation" ADD COLUMN     "batteryLevel" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "recoveryTrackingConsentAt" TIMESTAMP(3);
