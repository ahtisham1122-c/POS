ALTER TABLE "Supplier"
ADD COLUMN IF NOT EXISTS "milkSupplyMode" TEXT NOT NULL DEFAULT 'MIXED';

UPDATE "Supplier"
SET "milkSupplyMode" = 'MIXED'
WHERE "milkSupplyMode" IS NULL OR "milkSupplyMode" NOT IN ('MIXED', 'SEPARATE');
