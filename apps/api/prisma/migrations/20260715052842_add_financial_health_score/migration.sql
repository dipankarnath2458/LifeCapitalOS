-- CreateTable
CREATE TABLE "FinancialHealthScore" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "scoreModelVersion" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "categories" JSONB NOT NULL,
    "drivers" JSONB NOT NULL,
    "computedById" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialHealthScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialHealthScore_householdId_idx" ON "FinancialHealthScore"("householdId");

-- CreateIndex
CREATE INDEX "FinancialHealthScore_firmId_idx" ON "FinancialHealthScore"("firmId");

-- CreateIndex
CREATE INDEX "FinancialHealthScore_snapshotId_idx" ON "FinancialHealthScore"("snapshotId");

-- CreateIndex
CREATE INDEX "FinancialHealthScore_householdId_computedAt_idx" ON "FinancialHealthScore"("householdId", "computedAt");

-- AddForeignKey
ALTER TABLE "FinancialHealthScore" ADD CONSTRAINT "FinancialHealthScore_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lock down the new table: enable RLS with no policies so the Supabase public PostgREST
-- API (anon/authenticated keys) can't read/write it. The app reaches Postgres only via
-- Prisma using the database role, which bypasses RLS.
ALTER TABLE "FinancialHealthScore" ENABLE ROW LEVEL SECURITY;
