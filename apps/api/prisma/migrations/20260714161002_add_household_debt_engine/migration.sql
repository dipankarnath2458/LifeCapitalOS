-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('active', 'closed', 'written_off', 'archived');

-- CreateEnum
CREATE TYPE "DebtPaymentType" AS ENUM ('emi', 'extra', 'prepayment', 'foreclosure');

-- AlterEnum
ALTER TYPE "DebtType" ADD VALUE 'business_loan';

-- AlterTable
ALTER TABLE "Debt" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "dueDayOfMonth" INTEGER,
ADD COLUMN     "emiMinor" BIGINT,
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "lender" TEXT,
ADD COLUMN     "maturityAt" TIMESTAMP(3),
ADD COLUMN     "note" TEXT,
ADD COLUMN     "outstandingMinor" BIGINT,
ADD COLUMN     "secured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "status" "DebtStatus" NOT NULL DEFAULT 'active',
ADD COLUMN     "updatedById" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "DebtPayment" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "type" "DebtPaymentType" NOT NULL DEFAULT 'emi',
    "amountMinor" BIGINT NOT NULL,
    "principalMinor" BIGINT NOT NULL DEFAULT 0,
    "interestMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paidOn" TIMESTAMP(3) NOT NULL,
    "transactionId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtSnapshot" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "totalOutstandingMinor" BIGINT NOT NULL,
    "totalEmiMinor" BIGINT NOT NULL,
    "weightedAvgRatePct" DOUBLE PRECISION NOT NULL,
    "debtCount" INTEGER NOT NULL,
    "breakdown" JSONB,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DebtPayment_debtId_idx" ON "DebtPayment"("debtId");

-- CreateIndex
CREATE INDEX "DebtPayment_householdId_idx" ON "DebtPayment"("householdId");

-- CreateIndex
CREATE INDEX "DebtPayment_firmId_idx" ON "DebtPayment"("firmId");

-- CreateIndex
CREATE INDEX "DebtSnapshot_householdId_idx" ON "DebtSnapshot"("householdId");

-- CreateIndex
CREATE INDEX "DebtSnapshot_firmId_idx" ON "DebtSnapshot"("firmId");

-- CreateIndex
CREATE INDEX "DebtSnapshot_householdId_capturedAt_idx" ON "DebtSnapshot"("householdId", "capturedAt");

-- CreateIndex
CREATE INDEX "Debt_householdId_status_idx" ON "Debt"("householdId", "status");

-- CreateIndex
CREATE INDEX "Debt_entityId_idx" ON "Debt"("entityId");

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtSnapshot" ADD CONSTRAINT "DebtSnapshot_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lock down the new tables: enable RLS with no policies so the Supabase public
-- PostgREST API (anon/authenticated keys) can't read/write them. The app reaches
-- Postgres only via Prisma using the database role, which bypasses RLS.
ALTER TABLE "DebtPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DebtSnapshot" ENABLE ROW LEVEL SECURITY;
