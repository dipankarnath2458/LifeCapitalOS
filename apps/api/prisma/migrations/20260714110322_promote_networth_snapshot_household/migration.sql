-- AlterTable
ALTER TABLE "NetWorthSnapshot" ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "NetWorthSnapshot_householdId_capturedAt_idx" ON "NetWorthSnapshot"("householdId", "capturedAt");

-- AddForeignKey
ALTER TABLE "NetWorthSnapshot" ADD CONSTRAINT "NetWorthSnapshot_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
