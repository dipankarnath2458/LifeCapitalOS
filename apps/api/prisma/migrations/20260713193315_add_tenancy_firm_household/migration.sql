-- CreateEnum
CREATE TYPE "FirmRole" AS ENUM ('OWNER', 'ADVISOR', 'ANALYST', 'SUPPORT');

-- CreateEnum
CREATE TYPE "HouseholdRole" AS ENUM ('OWNER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('individual', 'huf', 'trust', 'llp', 'company', 'other');

-- CreateTable
CREATE TABLE "Firm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandName" TEXT,
    "logoKey" TEXT,
    "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
    "reviewCadence" TEXT NOT NULL DEFAULT 'quarterly',
    "status" TEXT NOT NULL DEFAULT 'active',
    "planId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Firm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firmRole" "FirmRole" NOT NULL DEFAULT 'SUPPORT',
    "status" TEXT NOT NULL DEFAULT 'active',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "advisorId" TEXT,
    "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "isDependent" BOOLEAN NOT NULL DEFAULT true,
    "householdRole" "HouseholdRole" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EntityType" NOT NULL DEFAULT 'individual',
    "taxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Firm_status_idx" ON "Firm"("status");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_firmId_userId_key" ON "Membership"("firmId", "userId");

-- CreateIndex
CREATE INDEX "Household_firmId_idx" ON "Household"("firmId");

-- CreateIndex
CREATE INDEX "Household_advisorId_idx" ON "Household"("advisorId");

-- CreateIndex
CREATE INDEX "HouseholdMember_householdId_idx" ON "HouseholdMember"("householdId");

-- CreateIndex
CREATE INDEX "HouseholdMember_userId_idx" ON "HouseholdMember"("userId");

-- CreateIndex
CREATE INDEX "Entity_householdId_idx" ON "Entity"("householdId");

-- CreateIndex
CREATE INDEX "Entity_firmId_idx" ON "Entity"("firmId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Household" ADD CONSTRAINT "Household_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS lockdown for the new tenancy tables. Matches enable_rls_lockdown: the app
-- reaches Postgres only via Prisma using the table-owner role (which bypasses RLS),
-- so enabling RLS with no policies denies all access through Supabase's PostgREST
-- API (anon/authenticated keys) without affecting the application. No table ships
-- without this.
ALTER TABLE "Firm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Household" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HouseholdMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Entity" ENABLE ROW LEVEL SECURITY;
