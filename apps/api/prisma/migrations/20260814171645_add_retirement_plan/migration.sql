-- M5.10 Retirement Planning. See docs/M5_10_RETIREMENT_PLANNING_ARCHITECTURE.md §17.
--
-- A new table only. No existing table is altered, nothing is re-keyed, and there is no backfill.
--
-- Every planning column is NULLABLE with NO DEFAULT. `null` means "not stated" — the service
-- applies documented defaults and reports which figures came from the family and which from us.
-- A default in the column would erase that distinction permanently.

-- CreateTable
CREATE TABLE "RetirementPlan" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "firmId" TEXT,
    "retirementAge" INTEGER,
    "lifeExpectancy" INTEGER,
    "desiredAnnualIncomeMinor" BIGINT,
    "monthlyContributionMinor" BIGINT,
    "currentCorpusMinor" BIGINT,
    "inflationRatePct" DOUBLE PRECISION,
    "preRetirementReturnPct" DOUBLE PRECISION,
    "postRetirementReturnPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetirementPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetirementPlan_householdId_key" ON "RetirementPlan"("householdId");

-- CreateIndex
CREATE INDEX "RetirementPlan_firmId_idx" ON "RetirementPlan"("firmId");

-- AddForeignKey
ALTER TABLE "RetirementPlan" ADD CONSTRAINT "RetirementPlan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
