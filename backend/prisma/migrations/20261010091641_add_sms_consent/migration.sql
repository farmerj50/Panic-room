-- AlterTable
ALTER TABLE "TrustedContact" ADD COLUMN     "smsConsentAt" TIMESTAMP(3),
ADD COLUMN     "smsConsentPhoneHash" TEXT,
ADD COLUMN     "smsConsentStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "smsConsentVersion" TEXT;

-- CreateTable
CREATE TABLE "ContactInvite" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ContactInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsConsentEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactId" TEXT,
    "phoneHash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "consentVersion" TEXT,
    "consentTextHash" TEXT,
    "inviteId" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "SmsConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsOptOut" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phoneHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "SmsOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsAlertState" (
    "id" TEXT NOT NULL,
    "emergencyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "lastReservedAt" TIMESTAMP(3),

    CONSTRAINT "SmsAlertState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emergencyId" TEXT NOT NULL,
    "contactId" TEXT,
    "toPhoneHash" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "twilioSid" TEXT,
    "errorCode" TEXT,
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactInvite_tokenHash_key" ON "ContactInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "ContactInvite_contactId_idx" ON "ContactInvite"("contactId");

-- CreateIndex
CREATE INDEX "SmsConsentEvent_phoneHash_idx" ON "SmsConsentEvent"("phoneHash");

-- CreateIndex
CREATE INDEX "SmsConsentEvent_createdAt_idx" ON "SmsConsentEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmsOptOut_phoneHash_key" ON "SmsOptOut"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "SmsAlertState_emergencyId_contactId_key" ON "SmsAlertState"("emergencyId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_twilioSid_key" ON "SmsMessage"("twilioSid");

-- CreateIndex
CREATE INDEX "SmsMessage_status_createdAt_idx" ON "SmsMessage"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ContactInvite" ADD CONSTRAINT "ContactInvite_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "TrustedContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactInvite" ADD CONSTRAINT "ContactInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsConsentEvent" ADD CONSTRAINT "SmsConsentEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "TrustedContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsAlertState" ADD CONSTRAINT "SmsAlertState_emergencyId_fkey" FOREIGN KEY ("emergencyId") REFERENCES "EmergencyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsAlertState" ADD CONSTRAINT "SmsAlertState_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "TrustedContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_emergencyId_fkey" FOREIGN KEY ("emergencyId") REFERENCES "EmergencyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "TrustedContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
