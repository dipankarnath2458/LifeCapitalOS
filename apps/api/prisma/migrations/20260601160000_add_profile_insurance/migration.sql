-- Add protection-tracking fields to Profile so the Insurance Gap and Wealth
-- Early Warning signals reflect real data. Backward-compatible: existing rows
-- default to no cover.
ALTER TABLE "Profile"
  ADD COLUMN IF NOT EXISTS "hasTermCover" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hasHealthInsurance" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "termLifeCoverMinor" BIGINT NOT NULL DEFAULT 0;
