-- Safe additive migration for Automation & Drip Workflows

-- 1. Create Workflow enums
DO $$ BEGIN
  CREATE TYPE "WorkflowTriggerType" AS ENUM ('CONTACT_SUBSCRIBED', 'TAG_ADDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "WorkflowStepType" AS ENUM ('EMAIL', 'DELAY', 'CONDITION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "WorkflowEnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'PAUSED', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "WorkflowExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Enhance Workflow model
ALTER TABLE "Workflow"
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'DRIP',
  ADD COLUMN IF NOT EXISTS "triggerType" "WorkflowTriggerType" NOT NULL DEFAULT 'CONTACT_SUBSCRIBED',
  ADD COLUMN IF NOT EXISTS "triggerConfig" JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Workflow" ALTER COLUMN "definition" DROP NOT NULL;
ALTER TABLE "Workflow" ALTER COLUMN "definition" SET DEFAULT '{}'::jsonb;

-- Workflow indexes & foreign keys
CREATE INDEX IF NOT EXISTS "Workflow_workspaceId_active_idx" ON "Workflow"("workspaceId", "active");
CREATE INDEX IF NOT EXISTS "Workflow_createdById_idx" ON "Workflow"("createdById");

DO $$ BEGIN
  ALTER TABLE "Workflow"
    ADD CONSTRAINT "Workflow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 3. Create WorkflowStep table
CREATE TABLE IF NOT EXISTS "WorkflowStep" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "stepOrder" INTEGER NOT NULL DEFAULT 0,
  "type" "WorkflowStepType" NOT NULL DEFAULT 'EMAIL',
  "name" TEXT,
  "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkflowStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowStep_workflowId_stepOrder_key" ON "WorkflowStep"("workflowId", "stepOrder");
CREATE INDEX IF NOT EXISTS "WorkflowStep_workflowId_idx" ON "WorkflowStep"("workflowId");

DO $$ BEGIN
  ALTER TABLE "WorkflowStep"
    ADD CONSTRAINT "WorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 4. Create WorkflowEnrollment table
CREATE TABLE IF NOT EXISTS "WorkflowEnrollment" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "status" "WorkflowEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "currentStepId" TEXT,
  "nextExecutionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "error" TEXT,

  CONSTRAINT "WorkflowEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowEnrollment_workflowId_contactId_key" ON "WorkflowEnrollment"("workflowId", "contactId");
CREATE INDEX IF NOT EXISTS "WorkflowEnrollment_workflowId_status_idx" ON "WorkflowEnrollment"("workflowId", "status");
CREATE INDEX IF NOT EXISTS "WorkflowEnrollment_contactId_idx" ON "WorkflowEnrollment"("contactId");
CREATE INDEX IF NOT EXISTS "WorkflowEnrollment_status_nextExecutionAt_idx" ON "WorkflowEnrollment"("status", "nextExecutionAt");

DO $$ BEGIN
  ALTER TABLE "WorkflowEnrollment"
    ADD CONSTRAINT "WorkflowEnrollment_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkflowEnrollment"
    ADD CONSTRAINT "WorkflowEnrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 5. Create WorkflowExecution table
CREATE TABLE IF NOT EXISTS "WorkflowExecution" (
  "id" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "status" "WorkflowExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "executedAt" TIMESTAMP(3),
  "error" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,

  CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WorkflowExecution_enrollmentId_idx" ON "WorkflowExecution"("enrollmentId");
CREATE INDEX IF NOT EXISTS "WorkflowExecution_stepId_idx" ON "WorkflowExecution"("stepId");
CREATE INDEX IF NOT EXISTS "WorkflowExecution_status_idx" ON "WorkflowExecution"("status");

DO $$ BEGIN
  ALTER TABLE "WorkflowExecution"
    ADD CONSTRAINT "WorkflowExecution_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "WorkflowEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkflowExecution"
    ADD CONSTRAINT "WorkflowExecution_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "WorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
