// MailFlow AI — Campaign Background Processing and Scheduling Engine
import { prisma } from "./db.mjs";
import { sendTransactionalEmail } from "./brevo.mjs";
import { signUnsubscribeToken, listUnsubscribeHeaders } from "./unsub.mjs";
import { buildEligibleContactsWhere } from "../routes/campaigns.mjs";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 10000; // 10s base backoff (10s, 20s, 40s)

/**
 * Checks if a recipient is eligible for retry under exponential backoff rules.
 * Uncertain outcomes are NEVER automatically retried to prevent duplicate emails.
 */
export function isEligibleForRetry(recipient, now = new Date()) {
  if (recipient.uncertain) return false;
  if (recipient.attempts === 0) return true;
  if (recipient.attempts >= MAX_RETRIES) return false;
  if (!recipient.lastAttemptAt) return true;

  const backoffMs = BASE_BACKOFF_MS * Math.pow(2, recipient.attempts);
  const elapsed = now.getTime() - new Date(recipient.lastAttemptAt).getTime();
  return elapsed >= backoffMs;
}

/**
 * Atomically finds and claims scheduled campaigns that have reached their scheduledAt time,
 * as well as recovering stale/interrupted SENDING campaigns.
 *
 * @param {Object} options
 * @param {Date} [options.now] - Current time override
 * @param {number} [options.maxCampaigns] - Maximum campaigns to claim in one cycle
 * @param {number} [options.batchSize] - Recipient batch size per campaign
 * @returns {Promise<{ processed: number, claimed: string[] }>}
 */
export function buildDueCampaignsWhere(now = new Date()) {
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
  return {
    OR: [
      {
        status: "SCHEDULED",
        scheduledAt: { lte: now }
      },
      {
        status: "SENDING",
        lockedAt: { lt: tenMinutesAgo }
      }
    ]
  };
}

export async function processDueCampaigns({
  now = new Date(),
  maxCampaigns = 5,
  batchSize = 50
} = {}) {
  const where = buildDueCampaignsWhere(now);
  const due = await prisma.campaign.findMany({
    where,
    take: maxCampaigns,
    orderBy: { scheduledAt: "asc" }
  });

  const claimedIds = [];

  for (const c of due) {
    // Atomic claim via optimistic lock
    const claim = await prisma.campaign.updateMany({
      where: {
        id: c.id,
        status: c.status
      },
      data: {
        status: "SENDING",
        lockedAt: now
      }
    });

    if (claim.count === 0) {
      // Another worker claimed this campaign concurrently
      continue;
    }

    claimedIds.push(c.id);

    try {
      await processCampaignBatch(c.id, { batchSize });
    } catch (err) {
      console.error(`Error processing campaign ${c.id}:`, err);
      // Unlock on fatal failure
      await prisma.campaign.update({
        where: { id: c.id },
        data: { lockedAt: null }
      }).catch(() => {});
    }
  }

  return {
    processed: claimedIds.length,
    claimed: claimedIds
  };
}

/**
 * Processes a bounded batch of recipients for a given campaign.
 *
 * @param {string} campaignId
 * @param {Object} options
 * @param {number} [options.batchSize]
 * @returns {Promise<Object>}
 */
export async function processCampaignBatch(campaignId, { batchSize = 50 } = {}) {
  const campaign = (await prisma.campaign.findUnique({
    where: { id: campaignId }
  })) || (await prisma.campaign.findFirst({
    where: { id: campaignId }
  }));

  if (!campaign) {
    return { success: false, error: "Campaign not found" };
  }

  if (campaign.status === "PAUSED") {
    return { success: false, paused: true, message: "Campaign is paused." };
  }

  if (campaign.status === "CANCELLED") {
    return { success: false, error: "Cannot process a cancelled campaign." };
  }

  if (campaign.status === "SENT") {
    return { success: false, error: "Campaign has already been sent." };
  }

  // 1. Recipient initialization (if not yet populated)
  const existingRecipientCount = await prisma.campaignRecipient.count({
    where: { campaignId }
  });

  if (existingRecipientCount === 0) {
    const eligibleWhere = buildEligibleContactsWhere(campaign.workspaceId, {
      targetTags: campaign.targetTags
    });
    const eligibleContacts = (await prisma.contact.findMany({
      where: eligibleWhere,
      select: { id: true, email: true }
    })) || [];

    if (eligibleContacts.length === 0) {
      // Zero eligible recipients: fail gracefully without crashing
      const updated = await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          lockedAt: null,
          sendTotal: 0
        }
      });
      return {
        success: false,
        error: "Cannot send campaign: No eligible subscribed contacts match the target audience.",
        campaign: updated
      };
    }

    await prisma.campaignRecipient.createMany({
      data: eligibleContacts.map(contact => ({
        campaignId,
        contactId: contact.id,
        email: contact.email,
        status: "PENDING"
      })),
      skipDuplicates: true
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        sendTotal: eligibleContacts.length,
        sentAt: campaign.sentAt || new Date()
      }
    });
  }

  // 2. Query pending recipients
  const pendingCandidates = (await prisma.campaignRecipient.findMany({
    where: {
      campaignId,
      status: "PENDING"
    },
    include: {
      contact: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          company: true,
          status: true
        }
      }
    },
    take: batchSize * 2 // Take extra to filter by backoff
  })) || [];

  const now = new Date();
  const batchRecipients = pendingCandidates
    .filter(r => isEligibleForRetry(r, now))
    .slice(0, batchSize);

  // If no recipients are eligible right now, check if some are waiting for backoff
  if (batchRecipients.length === 0) {
    if (pendingCandidates.length > 0) {
      // Recipients exist but waiting for exponential backoff window
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { lockedAt: null }
      });
      return {
        success: true,
        waitingForBackoff: true,
        remaining: pendingCandidates.length,
        message: `${pendingCandidates.length} recipient(s) waiting for retry backoff window.`
      };
    }

    // All recipients processed! Finalize campaign
    return finalizeCampaign(campaignId);
  }

  // 3. Process batch recipients
  let batchSucceeded = 0;
  let batchFailed = 0;
  let rateLimitEncountered = false;

  for (const r of batchRecipients) {
    // Check if campaign was paused during loop
    const checkState = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true }
    });
    if (checkState?.status === "PAUSED") {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { lockedAt: null }
      });
      return { success: true, paused: true, message: "Campaign paused during processing." };
    }

    // Validate contact subscription state
    if (r.contact?.status !== "SUBSCRIBED") {
      await prisma.campaignRecipient.update({
        where: { id: r.id },
        data: {
          status: "FAILED",
          error: `Contact not subscribed (status: ${r.contact?.status || "UNKNOWN"})`,
          attempts: r.attempts + 1,
          lastAttemptAt: new Date()
        }
      });
      batchFailed++;
      continue;
    }

    // Build personalization & unsubscribe compliance
    const baseUrl = process.env.PUBLIC_APP_URL || "https://mailflow.ai";
    let unsubUrl = "";
    let unsubHeaders = {};
    try {
      const unsubToken = signUnsubscribeToken({ contactId: r.contactId, workspaceId: campaign.workspaceId });
      unsubUrl = `${baseUrl.replace(/\/$/, "")}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
      unsubHeaders = listUnsubscribeHeaders({ contactId: r.contactId, workspaceId: campaign.workspaceId, baseUrl });
    } catch {
      unsubUrl = `${baseUrl.replace(/\/$/, "")}/api/unsubscribe?contactId=${r.contactId}`;
    }

    let personalizedHtml = campaign.html;
    personalizedHtml = personalizedHtml.replace(/\{\{\s*firstName\s*\}\}/gi, r.contact?.firstName || "there");
    personalizedHtml = personalizedHtml.replace(/\{\{\s*lastName\s*\}\}/gi, r.contact?.lastName || "");
    personalizedHtml = personalizedHtml.replace(/\{\{\s*email\s*\}\}/gi, r.contact?.email || r.email);
    personalizedHtml = personalizedHtml.replace(/\{\{\s*company\s*\}\}/gi, r.contact?.company || "");

    if (/\{\{\s*unsubscribe\s*\}\}/i.test(personalizedHtml)) {
      personalizedHtml = personalizedHtml.replace(/\{\{\s*unsubscribe\s*\}\}/gi, `<a href="${unsubUrl}">Unsubscribe</a>`);
    } else if (!personalizedHtml.toLowerCase().includes("unsubscribe")) {
      personalizedHtml += `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
  You received this email because you are subscribed to updates.
  <br /><a href="${unsubUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
</div>`;
    }

    // Dispatch via Brevo
    const sendResult = await sendTransactionalEmail({
      sender: {
        name: campaign.fromName || undefined,
        email: campaign.fromEmail
      },
      to: [{
        email: r.email,
        name: [r.contact?.firstName, r.contact?.lastName].filter(Boolean).join(" ") || undefined
      }],
      subject: campaign.subject,
      htmlContent: personalizedHtml,
      headers: unsubHeaders,
      tags: campaign.targetTags
    });

    if (sendResult.success) {
      await prisma.campaignRecipient.update({
        where: { id: r.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          messageId: sendResult.messageId || null,
          error: null,
          attempts: r.attempts + 1,
          lastAttemptAt: new Date()
        }
      });
      batchSucceeded++;
    } else if (sendResult.code === "HTTP_429") {
      // Rate limit hit: back off immediately without marking recipient as permanent failure
      await prisma.campaignRecipient.update({
        where: { id: r.id },
        data: {
          attempts: r.attempts + 1,
          lastAttemptAt: new Date(),
          error: "Brevo rate limit (HTTP 429). Retrying on next window."
        }
      });
      rateLimitEncountered = true;
      break; // Stop batch immediately to respect Brevo rate limit
    } else if (sendResult.code === "NETWORK_TIMEOUT") {
      // Uncertain outcome: do NOT blindly resend to avoid duplicate emails
      await prisma.campaignRecipient.update({
        where: { id: r.id },
        data: {
          status: "FAILED",
          uncertain: true,
          attempts: r.attempts + 1,
          lastAttemptAt: new Date(),
          error: "Uncertain delivery outcome: network timeout during dispatch. Requires verification before retry."
        }
      });
      batchFailed++;
    } else {
      // Other failure: differentiate permanent vs transient errors
      const code = String(sendResult?.code || "");
      const errStr = String(sendResult?.error || "").toLowerCase();
      const isTransient = code === "HTTP_500" || code === "HTTP_502" || code === "HTTP_503" || code === "HTTP_504" ||
        code === "ECONNRESET" || code === "ETIMEDOUT" ||
        errStr.includes("temporary") || errStr.includes("timeout") || errStr.includes("transient") || errStr.includes("connection error");

      const newAttempts = (r.attempts || 0) + 1;
      const reachedMax = !isTransient || newAttempts >= MAX_RETRIES;

      await prisma.campaignRecipient.update({
        where: { id: r.id },
        data: {
          status: reachedMax ? "FAILED" : "PENDING",
          attempts: newAttempts,
          lastAttemptAt: new Date(),
          error: !isTransient
            ? (sendResult.error || "Delivery error")
            : (reachedMax
                ? `Max retries exceeded (${MAX_RETRIES} attempts): ${sendResult.error}`
                : (sendResult.error || "Transient delivery error"))
        }
      });
      if (reachedMax) {
        batchFailed++;
      }
    }
  }

  // 4. Update campaign counters and release lock
  const [succeededCount, failedCount, remainingPending] = await Promise.all([
    prisma.campaignRecipient.count({ where: { campaignId, status: { in: ["SENT", "DELIVERED"] } } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: { in: ["FAILED", "BOUNCED", "COMPLAINED"] } } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: "PENDING" } })
  ]);

  if (remainingPending === 0) {
    return finalizeCampaign(campaignId, {
      counts: { succeededCount, failedCount, pendingCount: 0, uncertainCount: 0 },
      batch: {
        processed: batchRecipients.length,
        succeeded: batchSucceeded,
        failed: batchFailed,
        remaining: 0,
        rateLimited: rateLimitEncountered
      }
    });
  }

  const updatedCampaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      sendSucceeded: succeededCount,
      sendFailed: failedCount,
      lockedAt: null
    }
  });

  return {
    success: true,
    campaign: updatedCampaign,
    batch: {
      processed: batchRecipients.length,
      succeeded: batchSucceeded,
      failed: batchFailed,
      remaining: remainingPending,
      rateLimited: rateLimitEncountered
    },
    isComplete: false,
    message: rateLimitEncountered
      ? `Rate limit encountered. Batch halted with ${remainingPending} remaining.`
      : `Batch processed: ${batchSucceeded} sent, ${batchFailed} failed. ${remainingPending} recipient(s) remaining.`
  };
}

/**
 * Finalizes campaign status when all pending recipients have been processed.
 */
async function finalizeCampaign(campaignId, { counts, batch } = {}) {
  let succeededCount, failedCount, pendingCount, uncertainCount;
  if (counts && counts.succeededCount !== undefined) {
    succeededCount = counts.succeededCount;
    failedCount = counts.failedCount;
    pendingCount = counts.pendingCount || 0;
    uncertainCount = counts.uncertainCount || 0;
  } else {
    [succeededCount, failedCount, pendingCount, uncertainCount] = await Promise.all([
      prisma.campaignRecipient.count({ where: { campaignId, status: { in: ["SENT", "DELIVERED"] } } }),
      prisma.campaignRecipient.count({ where: { campaignId, status: { in: ["FAILED", "BOUNCED", "COMPLAINED"] } } }),
      prisma.campaignRecipient.count({ where: { campaignId, status: "PENDING" } }),
      prisma.campaignRecipient.count({ where: { campaignId, uncertain: true } }).catch(() => 0)
    ]);
  }

  // If any pending remain, do not mark completed
  if (pendingCount > 0) {
    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        sendSucceeded: succeededCount,
        sendFailed: failedCount,
        lockedAt: null
      }
    });
    return {
      success: true,
      campaign: updated,
      isComplete: false,
      batch: batch || {
        processed: 0,
        succeeded: succeededCount,
        failed: failedCount,
        remaining: pendingCount
      },
      message: `${pendingCount} recipient(s) still pending.`
    };
  }

  const finalStatus = succeededCount > 0 ? "SENT" : "FAILED";
  const completed = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: finalStatus,
      sendSucceeded: succeededCount,
      sendFailed: failedCount,
      completedAt: new Date(),
      lockedAt: null
    }
  });

  return {
    success: true,
    campaign: completed,
    isComplete: true,
    uncertainRecipients: uncertainCount || 0,
    batch: batch || {
      processed: succeededCount + failedCount,
      succeeded: succeededCount,
      failed: failedCount,
      remaining: 0
    },
    message: `Campaign complete: ${succeededCount} delivered/sent, ${failedCount} failed (${uncertainCount || 0} uncertain).`
  };
}

/**
 * Pauses a SENDING or SCHEDULED campaign.
 */
export async function pauseCampaign(campaignId, workspaceId) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId }
  });

  if (!campaign) {
    return { success: false, status: 404, error: "Campaign not found" };
  }

  if (campaign.status !== "SENDING" && campaign.status !== "SCHEDULED") {
    return {
      success: false,
      status: 400,
      error: `Only sending or scheduled campaigns can be paused (current status: ${campaign.status}).`
    };
  }

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "PAUSED",
      lockedAt: null
    }
  });

  return { success: true, campaign: updated, message: "Campaign paused." };
}

/**
 * Resumes a PAUSED campaign.
 */
export async function resumeCampaign(campaignId, workspaceId, { batchSize = 50 } = {}) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId }
  });

  if (!campaign) {
    return { success: false, status: 404, error: "Campaign not found" };
  }

  if (campaign.status !== "PAUSED") {
    return {
      success: false,
      status: 400,
      error: `Only paused campaigns can be resumed (current status: ${campaign.status}).`
    };
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "SENDING",
      lockedAt: new Date()
    }
  });

  // Begin processing next batch immediately
  const result = await processCampaignBatch(campaignId, { batchSize });
  return { success: true, ...result };
}

/**
 * Resets failed recipients for retry, excluding permanently suppressed contacts and uncertain outcomes.
 */
export async function retryFailedRecipients(campaignId, workspaceId, { batchSize = 50 } = {}) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId }
  });

  if (!campaign) {
    return { success: false, status: 404, error: "Campaign not found" };
  }

  // Reset FAILED recipients that are NOT uncertain and whose contacts are SUBSCRIBED
  const resetResult = await prisma.campaignRecipient.updateMany({
    where: {
      campaignId,
      status: "FAILED",
      uncertain: false,
      contact: {
        status: "SUBSCRIBED"
      }
    },
    data: {
      status: "PENDING",
      attempts: 0,
      lastAttemptAt: null,
      error: null
    }
  });

  if (resetResult.count === 0) {
    return {
      success: false,
      status: 400,
      error: "No retryable failed recipients found (uncertain or permanently suppressed recipients require manual review)."
    };
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "SENDING",
      lockedAt: new Date()
    }
  });

  const batchResult = await processCampaignBatch(campaignId, { batchSize });
  return {
    success: true,
    resetCount: resetResult.count,
    ...batchResult
  };
}

/**
 * Cancels a SCHEDULED campaign before sending begins, restoring it to DRAFT.
 */
export async function cancelScheduledCampaign(campaignId, workspaceId) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId }
  });

  if (!campaign) {
    return { success: false, status: 404, error: "Campaign not found" };
  }

  if (campaign.status !== "SCHEDULED") {
    return {
      success: false,
      status: 400,
      error: `Only scheduled campaigns can be cancelled (current status: ${campaign.status}).`
    };
  }

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "DRAFT",
      scheduledAt: null,
      lockedAt: null
    }
  });

  return { success: true, campaign: updated, message: "Campaign schedule cancelled." };
}
