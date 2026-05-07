-- Keep the cloud schema aligned with the Electron POS local schema.
-- These fields are produced by the refund/correction and close-register flows.

ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'CORRECTION';

ALTER TABLE "Return"
ADD COLUMN IF NOT EXISTS "correctionType" TEXT NOT NULL DEFAULT 'REFUND';

ALTER TABLE "CashRegister"
ADD COLUMN IF NOT EXISTS "expectedOnline" DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "closingOnline" DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "onlineVariance" DECIMAL(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE "Shift"
ADD COLUMN IF NOT EXISTS "expectedOnline" DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "closingOnline" DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "onlineVariance" DECIMAL(10, 2) NOT NULL DEFAULT 0;
