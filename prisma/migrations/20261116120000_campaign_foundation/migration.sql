-- Safe additive migration for Campaign model enhancements and CampaignRecipient tracking

-- 1. Add CANCELLED value to CampaignStatus enum
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- 2. Create RecipientStatus enum
DO $$ BEGIN
  CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 3. Add campaign metadata, sender, targeting, and metrics columns to Campaign
ALTER TABLE "Campaign"
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "templateId" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "fromName" TEXT,
  ADD COLUMN IF NOT EXISTS "fromEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "targetTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "targetStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sendTotal" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sendSucceeded" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sendFailed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "deliveredCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "bouncedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "openedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "clickedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "complainedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 4. Create CampaignRecipient table
CREATE TABLE IF NOT EXISTS "CampaignRecipient" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
  "messageId" TEXT,
  "sentAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "clickedAt" TIMESTAMP(3),
  "bouncedAt" TIMESTAMP(3),
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "uncertain" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- 5. Create indices
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignRecipient_campaignId_contactId_key" ON "CampaignRecipient"("campaignId", "contactId");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_contactId_idx" ON "CampaignRecipient"("contactId");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_messageId_idx" ON "CampaignRecipient"("messageId");
CREATE INDEX IF NOT EXISTS "Campaign_createdById_idx" ON "Campaign"("createdById");

-- 5b. Create DeliveryEvent table (webhook audit & deduplication)
CREATE TABLE IF NOT EXISTS "DeliveryEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "messageId" TEXT,
  "event" TEXT NOT NULL,
  "email" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryEvent_eventId_key" ON "DeliveryEvent"("eventId");
CREATE INDEX IF NOT EXISTS "DeliveryEvent_messageId_idx" ON "DeliveryEvent"("messageId");

-- 6. Add Foreign Key constraints
DO $$ BEGIN
  ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CampaignRecipient"
    ADD CONSTRAINT "CampaignRecipient_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CampaignRecipient"
    ADD CONSTRAINT "CampaignRecipient_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
