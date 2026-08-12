-- READ-ONLY. SELECT only. No INSERT / UPDATE / DELETE / DDL.
-- Detects households whose figures were accumulated by re-running the Wealth Health Check.
WITH dup_accounts AS (
  SELECT "householdId", COUNT(*) AS n
  FROM "Account"
  WHERE "householdId" IS NOT NULL
    AND name IN ('Cash & savings', 'Investments', 'Property')
  GROUP BY "householdId", name
  HAVING COUNT(*) > 1
),
dup_debts AS (
  SELECT "householdId", COUNT(*) AS n
  FROM "Debt"
  WHERE "householdId" IS NOT NULL
    AND name = 'Loan'
    AND status = 'active'
  GROUP BY "householdId"
  HAVING COUNT(*) > 1
),
dup_flows AS (
  SELECT "householdId", COUNT(*) AS n
  FROM "Transaction"
  WHERE "householdId" IS NOT NULL
    AND status <> 'void'
    AND ((type = 'income' AND category = 'salary')
      OR (type = 'expense' AND category = 'living'))
  GROUP BY "householdId", type, category, to_char("occurredAt", 'YYYY-MM')
  HAVING COUNT(*) > 1
),
affected AS (
  SELECT "householdId" FROM dup_accounts
  UNION SELECT "householdId" FROM dup_debts
  UNION SELECT "householdId" FROM dup_flows
)
SELECT
  (SELECT COUNT(*) FROM affected)                                   AS affected_households,
  (SELECT COUNT(DISTINCT "householdId") FROM dup_accounts)          AS with_duplicate_accounts,
  (SELECT COUNT(DISTINCT "householdId") FROM dup_debts)             AS with_duplicate_loans,
  (SELECT COUNT(DISTINCT "householdId") FROM dup_flows)             AS with_duplicate_cashflow,
  (SELECT COUNT(*) FROM "Household" WHERE status = 'active')        AS total_active_households;
