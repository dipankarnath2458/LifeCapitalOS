-- CreateEnum
CREATE TYPE "SnapshotGeneratedBy" AS ENUM ('manual', 'scheduled', 'event', 'migration');

-- CreateEnum
CREATE TYPE "FinancialSnapshotStatus" AS ENUM ('active', 'superseded', 'void');

-- CreateTable
CREATE TABLE "FinancialSnapshot" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "entityId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "engineVersion" TEXT NOT NULL,
    "fxVersion" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "generatedBy" "SnapshotGeneratedBy" NOT NULL DEFAULT 'manual',
    "createdById" TEXT,
    "checksum" TEXT NOT NULL,
    "status" "FinancialSnapshotStatus" NOT NULL DEFAULT 'active',
    "provenance" JSONB,
    "payload" JSONB NOT NULL,

    CONSTRAINT "FinancialSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialSnapshot_householdId_idx" ON "FinancialSnapshot"("householdId");

-- CreateIndex
CREATE INDEX "FinancialSnapshot_firmId_idx" ON "FinancialSnapshot"("firmId");

-- CreateIndex
CREATE INDEX "FinancialSnapshot_entityId_idx" ON "FinancialSnapshot"("entityId");

-- CreateIndex
CREATE INDEX "FinancialSnapshot_householdId_capturedAt_idx" ON "FinancialSnapshot"("householdId", "capturedAt");

-- CreateIndex
CREATE INDEX "FinancialSnapshot_householdId_snapshotVersion_idx" ON "FinancialSnapshot"("householdId", "snapshotVersion");

-- AddForeignKey
ALTER TABLE "FinancialSnapshot" ADD CONSTRAINT "FinancialSnapshot_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lock down the new table: enable RLS with no policies so the Supabase public PostgREST
-- API (anon/authenticated keys) can't read/write it. The app reaches Postgres only via
-- Prisma using the database role, which bypasses RLS.
ALTER TABLE "FinancialSnapshot" ENABLE ROW LEVEL SECURITY;
