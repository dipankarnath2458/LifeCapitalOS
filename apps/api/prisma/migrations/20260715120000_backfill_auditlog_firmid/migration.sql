-- Backfill the indexed AuditLog.firmId column from the firmId already stored in
-- metadata (write-through covers all new rows via AuditService). Data-only, idempotent,
-- additive — no schema change, no drift.
UPDATE "AuditLog"
SET "firmId" = "metadata"->>'firmId'
WHERE "firmId" IS NULL
  AND "metadata" IS NOT NULL
  AND ("metadata" ? 'firmId');
