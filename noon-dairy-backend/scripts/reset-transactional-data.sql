-- =============================================================================
-- Noon Dairy - RESET TRANSACTIONAL / TEST DATA
-- =============================================================================
-- Purpose:
--   Clean fake sales/testing data from the VPS PostgreSQL database before the
--   shop goes live.
--
-- Safety:
--   This script is destructive. It requires typed confirmation in psql before
--   it runs. Take a backup first. There is no undo after COMMIT.
--
-- Run on the VPS from noon-dairy-backend:
--
--   sudo -u postgres pg_dump noon_dairy_db | gzip > /var/backups/before-reset.sql.gz
--   sudo -u postgres psql -d noon_dairy_db -f scripts/reset-transactional-data.sql
--
-- Keeps:
--   - Users and login records
--   - Settings and daily rates
--   - Real device registrations
--   - Real product/customer/supplier master records, except obvious test/demo
--     masters matched below
--
-- Deletes:
--   - Sales, sale items, payments, split payments, ledgers
--   - Returns, return items, voids
--   - Stock movements
--   - Shifts, cash register rows, expenses
--   - Receipt audit sessions/entries
--   - Supplier milk collections/payments/ledgers
--   - Pending/fake test devices
--   - Obvious test/demo/fake customers, suppliers, and non-system products
--
-- After running:
--   - Product stock is reset to 0. Enter real opening stock in Inventory.
--   - Customer/supplier balances are reset to 0.
--   - Use the app Settings > Sync > Sync Now only after the reset is complete.
-- =============================================================================

\set ON_ERROR_STOP on

\echo 'WARNING: This will delete transactional/test data from the selected PostgreSQL database.'
\echo 'Backup first. To continue, type exactly: RESET_TRANSACTIONAL_DATA'
\prompt 'Confirmation: ' reset_confirm
SELECT CASE WHEN :'reset_confirm' = 'RESET_TRANSACTIONAL_DATA' THEN true ELSE false END AS reset_confirmed \gset
\if :reset_confirmed
\else
  \echo 'Reset cancelled. Nothing was changed.'
  \quit 1
\endif

\echo '--- Counts before reset ---'
SELECT 'Sale' AS table_name, COUNT(*) AS rows FROM "Sale"
UNION ALL SELECT 'Shift', COUNT(*) FROM "Shift"
UNION ALL SELECT 'CashRegister', COUNT(*) FROM "CashRegister"
UNION ALL SELECT 'Expense', COUNT(*) FROM "Expense"
UNION ALL SELECT 'StockMovement', COUNT(*) FROM "StockMovement"
UNION ALL SELECT 'MilkCollection', COUNT(*) FROM "MilkCollection"
UNION ALL SELECT 'Device', COUNT(*) FROM "Device"
UNION ALL SELECT 'Customer', COUNT(*) FROM "Customer"
UNION ALL SELECT 'Supplier', COUNT(*) FROM "Supplier"
UNION ALL SELECT 'Product', COUNT(*) FROM "Product"
UNION ALL SELECT 'User', COUNT(*) FROM "User"
ORDER BY table_name;

BEGIN;

-- Transactional tables. CASCADE is intentional: if Prisma adds/keeps a foreign
-- key between these records, this reset should still clear the whole fake flow.
TRUNCATE TABLE
    "ReturnItem",
    "Return",
    "SaleVoid",
    "SaleItem",
    "SplitPayment",
    "LedgerEntry",
    "Payment",
    "Sale",
    "StockMovement",
    "Expense",
    "CashRegister",
    "Shift",
    "ReceiptAuditEntry",
    "ReceiptAuditSession",
    "SupplierLedgerEntry",
    "SupplierPayment",
    "MilkCollection"
RESTART IDENTITY CASCADE;

-- Delete obvious fake master records that could otherwise be pulled down to
-- a fresh terminal. Keep system products and anything that does not clearly
-- look like test/demo data.
DELETE FROM "Customer"
WHERE "code" ILIKE 'TEST%'
   OR "code" ILIKE 'DEMO%'
   OR "code" ILIKE 'FAKE%'
   OR "name" ILIKE 'test %'
   OR "name" ILIKE 'demo %'
   OR "name" ILIKE 'fake %'
   OR COALESCE("phone", '') IN ('0000000000', '0000', '1234567890');

DELETE FROM "Supplier"
WHERE "code" ILIKE 'TEST%'
   OR "code" ILIKE 'DEMO%'
   OR "code" ILIKE 'FAKE%'
   OR "name" ILIKE 'test %'
   OR "name" ILIKE 'demo %'
   OR "name" ILIKE 'fake %'
   OR COALESCE("phone", '') IN ('0000000000', '0000', '1234567890');

DELETE FROM "Product"
WHERE "code" NOT IN ('MILK', 'YOGT')
  AND (
       "code" ILIKE 'TEST%'
    OR "code" ILIKE 'DEMO%'
    OR "code" ILIKE 'FAKE%'
    OR "name" ILIKE 'test %'
    OR "name" ILIKE 'demo %'
    OR "name" ILIKE 'fake %'
  );

-- Balances and stock are derived from the transactional rows we just removed.
UPDATE "Customer" SET "currentBalance" = 0;
UPDATE "Supplier" SET "currentBalance" = 0;
UPDATE "Product" SET "stock" = 0;

-- Remove diagnostic devices only. Real terminals stay registered.
DELETE FROM "Device"
WHERE "deviceId" LIKE 'test-%'
   OR "deviceId" LIKE 'verify-%'
   OR "deviceId" LIKE 'diag%'
   OR "deviceName" ILIKE '%diag%'
   OR "deviceName" ILIKE '%test%';

-- Keep recent audit history, but remove old noisy test logs.
DELETE FROM "ActivityLog" WHERE "createdAt" < NOW() - INTERVAL '30 days';

COMMIT;

\echo '--- Counts after reset ---'
SELECT 'Sale' AS table_name, COUNT(*) AS rows FROM "Sale"
UNION ALL SELECT 'Shift', COUNT(*) FROM "Shift"
UNION ALL SELECT 'CashRegister', COUNT(*) FROM "CashRegister"
UNION ALL SELECT 'Expense', COUNT(*) FROM "Expense"
UNION ALL SELECT 'StockMovement', COUNT(*) FROM "StockMovement"
UNION ALL SELECT 'MilkCollection', COUNT(*) FROM "MilkCollection"
UNION ALL SELECT 'Device', COUNT(*) FROM "Device"
UNION ALL SELECT 'Customer', COUNT(*) FROM "Customer"
UNION ALL SELECT 'Supplier', COUNT(*) FROM "Supplier"
UNION ALL SELECT 'Product', COUNT(*) FROM "Product"
UNION ALL SELECT 'User', COUNT(*) FROM "User"
ORDER BY table_name;
