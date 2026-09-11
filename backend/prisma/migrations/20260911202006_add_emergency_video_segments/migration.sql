-- CreateTable
CREATE TABLE "EmergencyVideoSegment" (
    "id" TEXT NOT NULL,
    "emergencyId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "facing" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyVideoSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmergencyVideoSegment_emergencyId_idx" ON "EmergencyVideoSegment"("emergencyId");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyVideoSegment_emergencyId_sequence_key" ON "EmergencyVideoSegment"("emergencyId", "sequence");

-- AddForeignKey
ALTER TABLE "EmergencyVideoSegment" ADD CONSTRAINT "EmergencyVideoSegment_emergencyId_fkey" FOREIGN KEY ("emergencyId") REFERENCES "EmergencyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
