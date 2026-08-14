-- M5.9 Protection. See docs/M5_9_PROTECTION_ARCHITECTURE.md §7.2.
--
-- All three columns are NULLABLE and have NO DEFAULT, on purpose. `null` means "not asked";
-- `false` means the family told us they have no cover. Defaulting to false would record every
-- household we have never asked as having stated it has no insurance.
--
-- There is no backfill for the same reason. Existing rows keep null and remain valid.

-- AlterTable
ALTER TABLE "HouseholdMember" ADD COLUMN     "hasHealthInsurance" BOOLEAN,
ADD COLUMN     "hasTermCover" BOOLEAN,
ADD COLUMN     "termLifeCoverMinor" BIGINT;
