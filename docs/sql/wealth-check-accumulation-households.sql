-- Read-only. Contains no write statements of any kind.
-- Lists WHICH households are affected. Run only when the count query returns more than zero;
-- as of 2026-08-12 it returned zero, so this has never been run against production.
WITH dup_accounts AS (
  SELECT "householdId", name, COUNT(*) AS copies
  FROM "Account"
  WHERE "householdId" IS NOT NULL AND name IN ('Cash & savings', 'Investments', 'Property')
  GROUP BY "householdId", name HAVING COUNT(*) > 1
),
dup_flows AS (
  SELECT "householdId", type, category, to_char("occurredAt", 'YYYY-MM') AS period, COUNT(*) AS copies
  FROM "Transaction"
  WHERE "householdId" IS NOT NULL AND status <> 'void'
    AND ((type = 'income' AND category = 'salary') OR (type = 'expense' AND category = 'living'))
  GROUP BY "householdId", type, category, to_char("occurredAt", 'YYYY-MM') HAVING COUNT(*) > 1
),
dup_debts AS (
  SELECT "householdId", COUNT(*) AS copies
  FROM "Debt"
  WHERE "householdId" IS NOT NULL AND name = 'Loan' AND status = 'active'
  GROUP BY "householdId" HAVING COUNT(*) > 1
)
SELECT
  h.id AS household_id,
  f.name AS workspace,
  COALESCE((SELECT SUM(copies) - COUNT(*) FROM dup_accounts d WHERE d."householdId" = h.id), 0) AS extra_accounts,
  COALESCE((SELECT SUM(copies) - COUNT(*) FROM dup_flows d WHERE d."householdId" = h.id), 0) AS extra_transactions,
  COALESCE((SELECT SUM(copies) - COUNT(*) FROM dup_debts d WHERE d."householdId" = h.id), 0) AS extra_loans
FROM "Household" h
JOIN "Firm" f ON f.id = h."firmId"
WHERE h.id IN (
  SELECT "householdId" FROM dup_accounts
  UNION SELECT "householdId" FROM dup_flows
  UNION SELECT "householdId" FROM dup_debts
)
ORDER BY f.name;
