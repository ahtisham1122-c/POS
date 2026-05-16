-- Wrong-entry returns are receipt corrections by default. Only rows explicitly
-- marked REFUND should reduce revenue/profit in reports.

ALTER TABLE "Return"
ALTER COLUMN "correctionType" SET DEFAULT 'CORRECTION';
