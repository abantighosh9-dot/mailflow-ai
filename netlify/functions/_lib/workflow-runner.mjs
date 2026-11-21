// MailFlow AI — Automation & Drip Workflow Execution Engine
import { prisma } from "./db.mjs";
import { sendTransactionalEmail } from "./brevo.mjs";
import { signUnsubscribeToken, listUnsubscribeHeaders } from "./unsub.mjs";

const MAX_EXECUTION_RETRIES = 3;

/**
 * Calculates step delay in milliseconds from configuration.
 * Supports minutes, hours, days.
 */
export function getStepDelayMs(config = {}) {
  const amount = Number(config.amount ?? config.delayMinutes ?? 0);
  const unit = String(config.unit || "minutes").toLowerCase();

  if (unit === "days" || unit === "day") {
    return Math.max(0, amount) * 24 * 60 * 60 * 1000;
  }
  if (unit === "hours" || unit === "hour") {
    return Math.max(0, amount) * 60 * 60 * 1000;
  }
  // Default minutes
  return Math.max(0, amount) * 60 * 1000;
}

/**
 * Calculates the next execution Date object for a step.
 */
export function calculateNextExecutionTime(step, fromDate = new Date()) {
  if (!step) return fromDate;
  if (step.type === "DELAY") {
    const delayMs = getStepDelayMs(step.config);
    return new Date(fromDate.getTime() + delayMs);
  }
  return fromDate;
}

/**
 * Evaluates a condition step against a contact.
 */
export function evaluateStepCondition(conditionConfig = {}, contact = {}) {
  const field = conditionConfig.field || "tags";
  const operator = conditionConfig.operator || "contains";
  const targetValue = String(conditionConfig.value || "").toLowerCase().trim();

  if (field === "tags") {
    const contactTags = (Array.isArray(contact.tags) ? contact.tags : []).map(t =>
      String(t).toLowerCase().trim()
    );
    if (operator === "contains" || operator === "equals") {
      return contactTags.includes(targetValue);
    }
    if (operator === "not_contains") {
      return !contactTags.includes(targetValue);
    }
  }

  if (field === "company") {
    const company = String(contact.company || "").toLowerCase();
    if (operator === "contains") return company.includes(targetValue);
    if (operator === "equals") return company === targetValue;
    if (operator === "is_not_empty") return company.length > 0;
  }

  return true;
}

/**
 * Triggers eligible active workflows when a contact event occurs (e.g. CONTACT_SUBSCRIBED or TAG_ADDED).
 * Automatically enrolls the contact and schedules the first step.
 */
export async function triggerWorkflowsForContact({
  workspaceId,
  contactId,
  event = "CONTACT_SUBSCRIBED",
  data = {},
  now = new Date()
}) {
  if (!workspaceId || !contactId) return { enrolled: [] };

  try {
    // 1. Verify contact exists and is in SUBSCRIBED status
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId }
    });

    if (!contact || contact.status !== "SUBSCRIBED") {
      return { enrolled: [], reason: "Contact ineligible or suppressed" };
    }

    // 2. Query active workflows matching the trigger event
    const activeWorkflows = await prisma.workflow.findMany({
      where: {
        workspaceId,
        active: true,
        triggerType: event
      },
      include: {
        steps: { orderBy: { stepOrder: "asc" } }
      }
    });

    const enrolledList = [];

    for (const wf of activeWorkflows) {
      if (wf.steps.length === 0) continue;

      // For TAG_ADDED trigger, verify tag matching rules
      if (event === "TAG_ADDED") {
        const requiredTag = wf.triggerConfig?.tag?.toLowerCase()?.trim();
        const incomingTag = data.tag?.toLowerCase()?.trim();
        if (requiredTag && incomingTag && requiredTag !== incomingTag) {
          continue; // Tag doesn't match
        }
      }

      // Check duplicate enrollment (contact can only be enrolled once per workflow)
      const existing = await prisma.workflowEnrollment.findUnique({
        where: {
          workflowId_contactId: {
            workflowId: wf.id,
            contactId: contact.id
          }
        }
      });

      if (existing) {
        continue; // Already enrolled
      }

      const firstStep = wf.steps[0];
      const nextExec = calculateNextExecutionTime(firstStep, now);

      const enrollment = await prisma.workflowEnrollment.create({
        data: {
          workflowId: wf.id,
          contactId: contact.id,
          status: "ACTIVE",
          currentStepId: firstStep.id,
          nextExecutionAt: nextExec,
          enrolledAt: now
        }
      });

      enrolledList.push(enrollment.id);
    }

    return { enrolled: enrolledList };
  } catch (err) {
    console.error("Error triggering workflows for contact:", err);
    return { enrolled: [], error: err.message };
  }
}

/**
 * Builds Prisma where clause for due workflow enrollments.
 */
export function buildDueEnrollmentsWhere(now = new Date()) {
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
  return {
    status: "ACTIVE",
    nextExecutionAt: { lte: now },
    workflow: { active: true },
    OR: [
      { lockedAt: null },
      { lockedAt: { lt: tenMinutesAgo } } // Recover stale locked executions
    ]
  };
}

/**
 * Executes a single workflow step for an enrollment.
 */
export async function executeEnrollmentStep({
  enrollment,
  step,
  contact,
  allSteps,
  now = new Date()
}) {
  const stepConfig = step.config || {};

  // 1. DUPLICATE EXECUTION PREVENTION: Check if already completed
  const existingExecution = await prisma.workflowExecution.findFirst({
    where: {
      enrollmentId: enrollment.id,
      stepId: step.id,
      status: "COMPLETED"
    }
  });

  if (existingExecution) {
    // Step already completed, advance to next
    return advanceEnrollmentToNextStep({ enrollment, currentStep: step, allSteps, now });
  }

  // 2. Handle Step Types
  if (step.type === "DELAY") {
    // Delay completed as of now
    await prisma.workflowExecution.create({
      data: {
        enrollmentId: enrollment.id,
        stepId: step.id,
        status: "COMPLETED",
        executedAt: now,
        metadata: { delayConfig: stepConfig }
      }
    });

    return advanceEnrollmentToNextStep({ enrollment, currentStep: step, allSteps, now });
  }

  if (step.type === "CONDITION") {
    const passed = evaluateStepCondition(stepConfig, contact);

    await prisma.workflowExecution.create({
      data: {
        enrollmentId: enrollment.id,
        stepId: step.id,
        status: "COMPLETED",
        executedAt: now,
        metadata: { conditionPassed: passed, conditionConfig: stepConfig }
      }
    });

    // If condition failed and branch specifies stop, complete the enrollment
    if (!passed && stepConfig.onFail === "STOP") {
      await prisma.workflowEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: "COMPLETED",
          completedAt: now,
          lockedAt: null
        }
      });
      return { completed: true, reason: "Condition failed (stopped)" };
    }

    return advanceEnrollmentToNextStep({ enrollment, currentStep: step, allSteps, now });
  }

  if (step.type === "EMAIL") {
    // 3. EMAIL STEP: Dispatch marketing email
    let execution = await prisma.workflowExecution.findFirst({
      where: { enrollmentId: enrollment.id, stepId: step.id }
    });

    if (!execution) {
      execution = await prisma.workflowExecution.create({
        data: {
          enrollmentId: enrollment.id,
          stepId: step.id,
          status: "RUNNING",
          retryCount: 0
        }
      });
    } else {
      await prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: "RUNNING" }
      });
    }

    // Build personalized content and headers
    const subject = (stepConfig.subject || "Important update from MailFlow").replace(/\{\{firstName\}\}/gi, contact.firstName || "there");
    const rawHtml = stepConfig.html || `<p>Hello ${contact.firstName || "there"},</p><p>${stepConfig.previewText || "Welcome to MailFlow updates."}</p>`;

    // Generate compliant unsubscribe link and headers
    const baseUrl = process.env.PUBLIC_APP_URL || process.env.CLIENT_URL || "http://localhost:8888";
    const workspaceId = contact.workspaceId || enrollment.workflow?.workspaceId || "ws_default";
    let extraHeaders = {};
    let unsubscribeUrl = `${baseUrl}/api/unsubscribe`;
    try {
      const unsubToken = signUnsubscribeToken({ contactId: contact.id, workspaceId });
      unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
      extraHeaders = listUnsubscribeHeaders({ contactId: contact.id, workspaceId, baseUrl });
    } catch (e) {
      // Fallback if env variable not set
      unsubscribeUrl = `${baseUrl}/api/unsubscribe`;
    }

    // Replace unsubscribe placeholder
    const htmlWithUnsub = rawHtml.replace(/\{\{unsubscribe_url\}\}/gi, unsubscribeUrl);

    try {
      const sendResult = await sendTransactionalEmail({
        to: contact.email,
        subject,
        html: htmlWithUnsub,
        senderName: stepConfig.fromName || "MailFlow AI",
        senderEmail: stepConfig.fromEmail || undefined,
        headers: extraHeaders
      });

      await prisma.workflowExecution.update({
        where: { id: execution.id },
        data: {
          status: "COMPLETED",
          executedAt: now,
          metadata: { messageId: sendResult.messageId }
        }
      });

      return advanceEnrollmentToNextStep({ enrollment, currentStep: step, allSteps, now });
    } catch (sendErr) {
      console.error(`Workflow email failed for contact ${contact.email}:`, sendErr);

      const nextRetryCount = (execution.retryCount || 0) + 1;
      const isFatal = nextRetryCount >= MAX_EXECUTION_RETRIES || sendErr.status === 400;

      await prisma.workflowExecution.update({
        where: { id: execution.id },
        data: {
          status: isFatal ? "FAILED" : "PENDING",
          retryCount: nextRetryCount,
          error: sendErr.message || "Email dispatch failed"
        }
      });

      if (isFatal) {
        await prisma.workflowEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: "FAILED",
            error: sendErr.message || "Maximum delivery retries exceeded",
            lockedAt: null
          }
        });
        return { failed: true, error: sendErr.message };
      }

      // Schedule retry with exponential backoff (15s * 2^attempts)
      const retryDelayMs = 15000 * Math.pow(2, nextRetryCount);
      await prisma.workflowEnrollment.update({
        where: { id: enrollment.id },
        data: {
          nextExecutionAt: new Date(now.getTime() + retryDelayMs),
          lockedAt: null
        }
      });

      return { retrying: true, retryCount: nextRetryCount };
    }
  }

  return advanceEnrollmentToNextStep({ enrollment, currentStep: step, allSteps, now });
}

/**
 * Advances a workflow enrollment to its next sequential step or marks it completed.
 */
export async function advanceEnrollmentToNextStep({
  enrollment,
  currentStep,
  allSteps,
  now = new Date()
}) {
  const currentIndex = allSteps.findIndex(s => s.id === currentStep.id);
  const nextStep = allSteps[currentIndex + 1];

  if (!nextStep) {
    // Workflow finished!
    await prisma.workflowEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        lockedAt: null
      }
    });
    return { completed: true };
  }

  // Calculate next step timing
  let nextExec = now;
  if (nextStep.type === "DELAY") {
    const delayMs = getStepDelayMs(nextStep.config);
    nextExec = new Date(now.getTime() + delayMs);
  }

  await prisma.workflowEnrollment.update({
    where: { id: enrollment.id },
    data: {
      currentStepId: nextStep.id,
      nextExecutionAt: nextExec,
      lockedAt: null
    }
  });

  return { nextStepId: nextStep.id, nextExecutionAt: nextExec };
}

/**
 * Main cron entrypoint: Finds due workflow enrollments, claims them atomically, and executes steps.
 */
export async function processDueWorkflows({
  now = new Date(),
  maxEnrollments = 25
} = {}) {
  const where = buildDueEnrollmentsWhere(now);

  const dueEnrollments = await prisma.workflowEnrollment.findMany({
    where,
    take: maxEnrollments,
    orderBy: { nextExecutionAt: "asc" },
    include: {
      workflow: {
        include: {
          steps: { orderBy: { stepOrder: "asc" } }
        }
      },
      contact: true
    }
  });

  const results = {
    processed: 0,
    completed: 0,
    failed: 0,
    suppressed: 0
  };

  for (const en of dueEnrollments) {
    // 1. Optimistic Concurrency Lock
    const claim = await prisma.workflowEnrollment.updateMany({
      where: {
        id: en.id,
        status: "ACTIVE",
        OR: [{ lockedAt: null }, { lockedAt: en.lockedAt }]
      },
      data: {
        lockedAt: now
      }
    });

    if (claim.count === 0) {
      continue; // Claimed concurrently by another process
    }

    try {
      // 2. SUPPRESSION & ELIGIBILITY GUARD:
      // If contact unsubscribed, bounced, or was deleted, cancel enrollment immediately!
      if (!en.contact || en.contact.status !== "SUBSCRIBED") {
        await prisma.workflowEnrollment.update({
          where: { id: en.id },
          data: {
            status: "CANCELLED",
            error: `Contact suppressed (Status: ${en.contact?.status || "DELETED"})`,
            lockedAt: null,
            completedAt: now
          }
        });
        results.suppressed += 1;
        continue;
      }

      // 3. Resolve Current Step
      const steps = en.workflow?.steps || [];
      if (steps.length === 0) {
        await prisma.workflowEnrollment.update({
          where: { id: en.id },
          data: { status: "COMPLETED", completedAt: now, lockedAt: null }
        });
        results.completed += 1;
        continue;
      }

      let currentStep = steps.find(s => s.id === en.currentStepId);
      if (!currentStep) {
        currentStep = steps[0];
      }

      // 4. Execute Current Step
      const execResult = await executeEnrollmentStep({
        enrollment: en,
        step: currentStep,
        contact: en.contact,
        allSteps: steps,
        now
      });

      results.processed += 1;
      if (execResult.completed) results.completed += 1;
      if (execResult.failed) results.failed += 1;
    } catch (err) {
      console.error(`Workflow enrollment processing failed for enrollment ${en.id}:`, err);
      // Unlock on error
      await prisma.workflowEnrollment.update({
        where: { id: en.id },
        data: { lockedAt: null, error: err.message }
      }).catch(() => {});
      results.failed += 1;
    }
  }

  return results;
}
