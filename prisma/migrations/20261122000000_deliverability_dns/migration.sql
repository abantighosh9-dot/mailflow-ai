-- Safe additive migration for Email Deliverability & DNS Domain Authentication

-- 1. Create Enums
DO $$ BEGIN
  CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "DnsRecordType" AS ENUM ('TXT', 'CNAME', 'MX');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "DnsRecordStatus" AS ENUM ('VERIFIED', 'MISSING', 'INVALID', 'PENDING');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "DnsRecordPurpose" AS ENUM ('SPF', 'DKIM', 'DMARC', 'TRACKING');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "DeliverabilityRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Create SendingDomain table
CREATE TABLE IF NOT EXISTS "SendingDomain" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "status" "DomainStatus" NOT NULL DEFAULT 'PENDING',
  "spfStatus" "DnsRecordStatus" NOT NULL DEFAULT 'PENDING',
  "dkimStatus" "DnsRecordStatus" NOT NULL DEFAULT 'PENDING',
  "dmarcStatus" "DnsRecordStatus" NOT NULL DEFAULT 'PENDING',
  "customTrackingStatus" "DnsRecordStatus" NOT NULL DEFAULT 'PENDING',
  "trackingSubdomain" TEXT DEFAULT 'track',
  "dkimSelector" TEXT NOT NULL DEFAULT 'mailo',
  "healthScore" INTEGER NOT NULL DEFAULT 50,
  "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SendingDomain_pkey" PRIMARY KEY ("id")
);

-- SendingDomain indexes & constraints
CREATE UNIQUE INDEX IF NOT EXISTS "SendingDomain_workspaceId_domain_key" ON "SendingDomain"("workspaceId", "domain");
CREATE INDEX IF NOT EXISTS "SendingDomain_workspaceId_idx" ON "SendingDomain"("workspaceId");
CREATE INDEX IF NOT EXISTS "SendingDomain_domain_idx" ON "SendingDomain"("domain");

DO $$ BEGIN
  ALTER TABLE "SendingDomain"
    ADD CONSTRAINT "SendingDomain_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 3. Create DomainDnsRecord table
CREATE TABLE IF NOT EXISTS "DomainDnsRecord" (
  "id" TEXT NOT NULL,
  "domainId" TEXT NOT NULL,
  "recordType" "DnsRecordType" NOT NULL,
  "name" TEXT NOT NULL,
  "expectedValue" TEXT NOT NULL,
  "actualValue" TEXT,
  "status" "DnsRecordStatus" NOT NULL DEFAULT 'PENDING',
  "purpose" "DnsRecordPurpose" NOT NULL,
  "lastCheckedAt" TIMESTAMP(3),
  "errorMessage" TEXT,

  CONSTRAINT "DomainDnsRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DomainDnsRecord_domainId_idx" ON "DomainDnsRecord"("domainId");

DO $$ BEGIN
  ALTER TABLE "DomainDnsRecord"
    ADD CONSTRAINT "DomainDnsRecord_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "SendingDomain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 4. Create DeliverabilityCheck table
CREATE TABLE IF NOT EXISTS "DeliverabilityCheck" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "campaignId" TEXT,
  "subject" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "riskLevel" "DeliverabilityRiskLevel" NOT NULL DEFAULT 'LOW',
  "issues" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "suggestions" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DeliverabilityCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeliverabilityCheck_workspaceId_idx" ON "DeliverabilityCheck"("workspaceId");
CREATE INDEX IF NOT EXISTS "DeliverabilityCheck_campaignId_idx" ON "DeliverabilityCheck"("campaignId");

DO $$ BEGIN
  ALTER TABLE "DeliverabilityCheck"
    ADD CONSTRAINT "DeliverabilityCheck_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "DeliverabilityCheck"
    ADD CONSTRAINT "DeliverabilityCheck_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 5. Create DomainHealthHistory table
CREATE TABLE IF NOT EXISTS "DomainHealthHistory" (
  "id" TEXT NOT NULL,
  "domainId" TEXT NOT NULL,
  "healthScore" INTEGER NOT NULL,
  "spfOk" BOOLEAN NOT NULL DEFAULT false,
  "dkimOk" BOOLEAN NOT NULL DEFAULT false,
  "dmarcOk" BOOLEAN NOT NULL DEFAULT false,
  "trackingOk" BOOLEAN NOT NULL DEFAULT false,
  "deliveryRate" DOUBLE PRECISION,
  "bounceRate" DOUBLE PRECISION,
  "complaintRate" DOUBLE PRECISION,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DomainHealthHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DomainHealthHistory_domainId_idx" ON "DomainHealthHistory"("domainId");
CREATE INDEX IF NOT EXISTS "DomainHealthHistory_recordedAt_idx" ON "DomainHealthHistory"("recordedAt");

DO $$ BEGIN
  ALTER TABLE "DomainHealthHistory"
    ADD CONSTRAINT "DomainHealthHistory_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "SendingDomain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
