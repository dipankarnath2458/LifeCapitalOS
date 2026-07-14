-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "firmId" TEXT,
ADD COLUMN     "householdId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "firmId" TEXT;

-- AlterTable
ALTER TABLE "Consent" ADD COLUMN     "firmId" TEXT,
ADD COLUMN     "householdId" TEXT;

-- AlterTable
ALTER TABLE "Debt" ADD COLUMN     "firmId" TEXT,
ADD COLUMN     "householdId" TEXT;

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "firmId" TEXT,
ADD COLUMN     "householdId" TEXT,
ADD COLUMN     "memberId" TEXT;

-- AlterTable
ALTER TABLE "NetWorthSnapshot" ADD COLUMN     "firmId" TEXT,
ADD COLUMN     "householdId" TEXT;

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN     "firmId" TEXT,
ADD COLUMN     "householdId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "firmId" TEXT,
ADD COLUMN     "householdId" TEXT;

-- CreateIndex
CREATE INDEX "Account_firmId_idx" ON "Account"("firmId");

-- CreateIndex
CREATE INDEX "Account_householdId_idx" ON "Account"("householdId");

-- CreateIndex
CREATE INDEX "Account_entityId_idx" ON "Account"("entityId");

-- CreateIndex
CREATE INDEX "AuditLog_firmId_idx" ON "AuditLog"("firmId");

-- CreateIndex
CREATE INDEX "Consent_firmId_idx" ON "Consent"("firmId");

-- CreateIndex
CREATE INDEX "Consent_householdId_idx" ON "Consent"("householdId");

-- CreateIndex
CREATE INDEX "Debt_firmId_idx" ON "Debt"("firmId");

-- CreateIndex
CREATE INDEX "Debt_householdId_idx" ON "Debt"("householdId");

-- CreateIndex
CREATE INDEX "Goal_firmId_idx" ON "Goal"("firmId");

-- CreateIndex
CREATE INDEX "Goal_householdId_idx" ON "Goal"("householdId");

-- CreateIndex
CREATE INDEX "Goal_memberId_idx" ON "Goal"("memberId");

-- CreateIndex
CREATE INDEX "NetWorthSnapshot_firmId_idx" ON "NetWorthSnapshot"("firmId");

-- CreateIndex
CREATE INDEX "NetWorthSnapshot_householdId_idx" ON "NetWorthSnapshot"("householdId");

-- CreateIndex
CREATE INDEX "Recommendation_firmId_idx" ON "Recommendation"("firmId");

-- CreateIndex
CREATE INDEX "Recommendation_householdId_idx" ON "Recommendation"("householdId");

-- CreateIndex
CREATE INDEX "Transaction_firmId_idx" ON "Transaction"("firmId");

-- CreateIndex
CREATE INDEX "Transaction_householdId_idx" ON "Transaction"("householdId");
