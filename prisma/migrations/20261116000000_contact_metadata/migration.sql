-- Safe additive migration: existing contacts receive the same source value
-- that manual contact creation has historically assigned in the API.
ALTER TABLE "Contact"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "unsubscribedAt" TIMESTAMP(3);
