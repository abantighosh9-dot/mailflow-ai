// Campaign routes for MailFlow AI
import express from "express";
import { prisma } from "../_lib/db.mjs";
import { auth as requireAuth, requireRole } from "../_lib/auth.mjs";
import { sendTransactionalEmail } from "../_lib/brevo.mjs";
import { signUnsubscribeToken, listUnsubscribeHeaders } from "../_lib/unsub.mjs";
import {
  processCampaignBatch,
  pauseCampaign,
  resumeCampaign,
  retryFailedRecipients,
  processDueCampaigns
} from "../_lib/campaign-runner.mjs";
import { z } from "zod";

const router = express.Router();

// Validation schemas (Zod 4.1)
const campaignCreateSchema = z.object({
  name: z.string().trim().min(1, "Campaign name is required").max(200, "Name too long"),
  subject: z.string().trim().min(1, "Subject line is required").max(500, "Subject too long"),
  previewText: z.string().trim().max(300).optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  fromName: z.string().trim().max(100).optional().nullable(),
  fromEmail: z.string().trim().email("Invalid sender email address").optional().nullable(),
  html: z.string().optional().default(""),
  templateId: z.string().trim().optional().nullable(),
  targetTags: z.array(z.string().trim().toLowerCase()).max(50).optional().default([]),
  targetStatus: z.string().optional().default("SUBSCRIBED")
});

const campaignPatchSchema = z.object({
  name: z.string().trim().min(1, "Campaign name cannot be empty").max(200).optional(),
  subject: z.string().trim().min(1, "Subject line cannot be empty").max(500).optional(),
  previewText: z.string().trim().max(300).optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  fromName: z.string().trim().max(100).optional().nullable(),
  fromEmail: z.string().trim().email("Invalid sender email address").optional().nullable(),
  html: z.string().optional(),
  templateId: z.string().trim().optional().nullable(),
  targetTags: z.array(z.string().trim().toLowerCase()).max(50).optional(),
  targetStatus: z.string().optional().nullable()
});

/**
 * Builds Prisma where filter for contacts eligible to receive campaigns.
 * Strictly enforces that only SUBSCRIBED contacts within the authenticated workspace are eligible.
 * Excludes UNSUBSCRIBED, BOUNCED, and COMPLAINED contacts.
 */
export function buildEligibleContactsWhere(workspaceId, { targetTags = [] } = {}) {
  const where = {
    workspaceId,
    status: "SUBSCRIBED"
  };

  const cleanTags = (Array.isArray(targetTags) ? targetTags : [])
    .map(t => String(t || "").trim().toLowerCase())
    .filter(Boolean);

  if (cleanTags.length > 0) {
    where.tags = { hasSome: cleanTags };
  }

  return where;
}

// GET /campaigns — List workspace campaigns with pagination, search, and status filter
router.get("/campaigns", requireAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) return res.status(401).json({ error: "Workspace context missing." });

  const { page = "1", limit = "20", q = "", status } = req.query;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const where = { workspaceId };
  const and = [];

  const search = String(q || "").trim();
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { subject: { contains: search, mode: "insensitive" } }
      ]
    });
  }

  const validStatuses = ["DRAFT", "SCHEDULED", "QUEUED", "SENDING", "SENT", "PAUSED", "CANCELLED", "FAILED"];
  if (status && validStatuses.includes(String(status).toUpperCase())) {
    and.push({ status: String(status).toUpperCase() });
  }

  if (and.length > 0) {
    where.AND = and;
  }

  try {
    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: "desc" },
        include: {
          template: { select: { id: true, name: true } },
          _count: { select: { recipients: true } }
        }
      }),
      prisma.campaign.count({ where })
    ]);

    return res.json({
      campaigns,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1
    });
  } catch (err) {
    console.error("GET /campaigns failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /campaigns/:id — Get one campaign with template, metrics, and eligible recipient count
router.get("/campaigns/:id", requireAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId },
      include: {
        template: true,
        createdBy: { select: { id: true, name: true, email: true } },
        _count: { select: { recipients: true } }
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Resolve counts for previewing dispatch volume and live progress
    const eligibleWhere = buildEligibleContactsWhere(workspaceId, { targetTags: campaign.targetTags });
    const [eligibleCount, pendingCount, uncertainCount] = await Promise.all([
      prisma.contact.count({ where: eligibleWhere }),
      prisma.campaignRecipient.count({ where: { campaignId: id, status: "PENDING" } }),
      prisma.campaignRecipient.count({ where: { campaignId: id, uncertain: true } })
    ]);

    return res.json({
      campaign: {
        ...campaign,
        eligibleRecipientsCount: eligibleCount,
        pendingRecipientsCount: pendingCount,
        uncertainRecipientsCount: uncertainCount
      }
    });
  } catch (err) {
    console.error("GET /campaigns/:id failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /campaigns/:id/recipients — Preview eligible recipients for campaign
router.get("/campaigns/:id/recipients", requireAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId },
      select: { id: true, targetTags: true }
    });

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const eligibleWhere = buildEligibleContactsWhere(workspaceId, { targetTags: campaign.targetTags });
    const [total, sample] = await Promise.all([
      prisma.contact.count({ where: eligibleWhere }),
      prisma.contact.findMany({
        where: eligibleWhere,
        take: 10,
        select: { id: true, email: true, firstName: true, lastName: true, company: true, tags: true }
      })
    ]);

    return res.json({ total, sample });
  } catch (err) {
    console.error("GET /campaigns/:id/recipients failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /campaigns — Create a draft campaign
router.post("/campaigns", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) return res.status(401).json({ error: "Workspace context missing." });

  const parseResult = campaignCreateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues.map(i => i.message).join(", ") });
  }

  const data = parseResult.data;

  try {
    // If a templateId is specified, verify it belongs to the authenticated workspace
    let template = null;
    if (data.templateId) {
      template = await prisma.emailTemplate.findFirst({
        where: { id: data.templateId, workspaceId }
      });
      if (!template) {
        return res.status(400).json({ error: "Template not found or does not belong to this workspace." });
      }
    }

    const htmlContent = data.html || template?.html || "";

    const campaign = await prisma.campaign.create({
      data: {
        workspaceId,
        createdById: req.user?.id || null,
        templateId: template ? template.id : null,
        name: data.name,
        description: data.description || null,
        subject: data.subject || template?.subject || "",
        previewText: data.previewText || template?.previewText || null,
        fromName: data.fromName || null,
        fromEmail: data.fromEmail || null,
        html: htmlContent,
        targetTags: data.targetTags || [],
        targetStatus: "SUBSCRIBED",
        status: "DRAFT"
      },
      include: {
        template: { select: { id: true, name: true } }
      }
    });

    return res.status(201).json({ campaign });
  } catch (err) {
    console.error("POST /campaigns failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /campaigns/:id — Update an editable draft campaign
router.patch("/campaigns/:id", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const current = await prisma.campaign.findFirst({
      where: { id, workspaceId }
    });

    if (!current) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Only DRAFT campaigns can be edited
    if (current.status !== "DRAFT") {
      return res.status(400).json({ error: "Only draft campaigns can be edited." });
    }

    const parseResult = campaignPatchSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.issues.map(i => i.message).join(", ") });
    }

    const data = parseResult.data;

    // If templateId is being updated, verify it belongs to the workspace
    if (data.templateId !== undefined && data.templateId !== null) {
      const template = await prisma.emailTemplate.findFirst({
        where: { id: data.templateId, workspaceId }
      });
      if (!template) {
        return res.status(400).json({ error: "Template not found or does not belong to this workspace." });
      }
    }

    const updateData = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.subject !== undefined) updateData.subject = data.subject;
    if (data.previewText !== undefined) updateData.previewText = data.previewText;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.fromName !== undefined) updateData.fromName = data.fromName;
    if (data.fromEmail !== undefined) updateData.fromEmail = data.fromEmail;
    if (data.html !== undefined) updateData.html = data.html;
    if (data.templateId !== undefined) updateData.templateId = data.templateId;
    if (data.targetTags !== undefined) updateData.targetTags = data.targetTags;
    if (data.targetStatus !== undefined) updateData.targetStatus = data.targetStatus;

    const updated = await prisma.campaign.update({
      where: { id },
      data: updateData,
      include: {
        template: { select: { id: true, name: true } }
      }
    });

    return res.json({ campaign: updated });
  } catch (err) {
    console.error("PATCH /campaigns/:id failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /campaigns/:id — Delete a draft campaign
router.delete("/campaigns/:id", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const current = await prisma.campaign.findFirst({
      where: { id, workspaceId }
    });

    if (!current) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Only DRAFT campaigns can be deleted
    if (current.status !== "DRAFT") {
      return res.status(400).json({ error: "Only draft campaigns can be deleted." });
    }

    await prisma.campaign.delete({
      where: { id }
    });

    return res.status(200).json({ success: true, message: "Campaign deleted." });
  } catch (err) {
    console.error("DELETE /campaigns/:id failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /campaigns/:id/schedule — Schedule a draft campaign for future sending
router.post("/campaigns/:id/schedule", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const current = await prisma.campaign.findFirst({
      where: { id, workspaceId }
    });

    if (!current) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Only DRAFT campaigns can be scheduled
    if (current.status !== "DRAFT") {
      return res.status(400).json({ error: "Only draft campaigns can be scheduled." });
    }

    const { scheduledAt } = req.body || {};
    if (!scheduledAt) {
      return res.status(400).json({ error: "scheduledAt date and time is required." });
    }

    const targetDate = new Date(scheduledAt);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ error: "scheduledAt must be a valid date and time." });
    }

    if (targetDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: "Scheduled date and time must be in the future." });
    }

    // Validate campaign readiness before scheduling
    if (!current.name || !current.name.trim()) {
      return res.status(400).json({ error: "Campaign name is required before scheduling." });
    }
    if (!current.subject || !current.subject.trim()) {
      return res.status(400).json({ error: "Campaign subject line is required before scheduling." });
    }
    if (!current.html || !current.html.trim()) {
      return res.status(400).json({ error: "Campaign email body cannot be empty before scheduling." });
    }
    if (!current.fromEmail || !current.fromEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(current.fromEmail.trim())) {
      return res.status(400).json({ error: "A valid sender email address is required before scheduling." });
    }

    // Confirm eligible subscribed recipients exist
    const eligibleWhere = buildEligibleContactsWhere(workspaceId, { targetTags: current.targetTags });
    const eligibleCount = await prisma.contact.count({ where: eligibleWhere });

    if (eligibleCount === 0) {
      return res.status(400).json({
        error: "Cannot schedule campaign: No eligible subscribed contacts match the target audience."
      });
    }

    const scheduled = await prisma.campaign.update({
      where: { id },
      data: {
        status: "SCHEDULED",
        scheduledAt: targetDate,
        sendTotal: eligibleCount
      },
      include: {
        template: { select: { id: true, name: true } }
      }
    });

    return res.json({
      campaign: scheduled,
      eligibleRecipientsCount: eligibleCount,
      message: `Campaign scheduled for ${targetDate.toISOString()}.`
    });
  } catch (err) {
    console.error("POST /campaigns/:id/schedule failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /campaigns/:id/cancel-schedule — Cancel scheduled sending and return campaign to draft
router.post("/campaigns/:id/cancel-schedule", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const current = await prisma.campaign.findFirst({
      where: { id, workspaceId }
    });

    if (!current) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Only SCHEDULED campaigns can have their schedule cancelled
    if (current.status !== "SCHEDULED") {
      return res.status(400).json({ error: "Only scheduled campaigns can have their schedule cancelled." });
    }

    const cancelled = await prisma.campaign.update({
      where: { id },
      data: {
        status: "DRAFT",
        scheduledAt: null
      },
      include: {
        template: { select: { id: true, name: true } }
      }
    });

    return res.json({
      campaign: cancelled,
      message: "Campaign schedule cancelled. Campaign returned to draft status."
    });
  } catch (err) {
    console.error("POST /campaigns/:id/cancel-schedule failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /campaigns/:id/send — Dispatch campaign emails via Brevo with bounded batching
router.post("/campaigns/:id/send", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const current = await prisma.campaign.findFirst({
      where: { id, workspaceId }
    });

    if (!current) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Status validation
    if (current.status === "SENT") {
      return res.status(400).json({ error: "Campaign has already been sent." });
    }
    if (current.status === "CANCELLED") {
      return res.status(400).json({ error: "Cannot send a cancelled campaign." });
    }

    const eligibleStatuses = ["DRAFT", "SCHEDULED", "QUEUED", "SENDING", "FAILED"];
    if (!eligibleStatuses.includes(current.status)) {
      return res.status(400).json({ error: `Campaign cannot be sent in status: ${current.status}` });
    }

    // Content & sender validation
    if (!current.name || !current.name.trim()) {
      return res.status(400).json({ error: "Campaign name is required before sending." });
    }
    if (!current.subject || !current.subject.trim()) {
      return res.status(400).json({ error: "Campaign subject line is required before sending." });
    }
    if (!current.html || !current.html.trim()) {
      return res.status(400).json({ error: "Campaign email body cannot be empty before sending." });
    }
    if (!current.fromEmail || !current.fromEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(current.fromEmail.trim())) {
      return res.status(400).json({ error: "A valid sender email address is required before sending." });
    }

    // Transition to SENDING with concurrency lock
    await prisma.campaign.update({
      where: { id },
      data: {
        status: "SENDING",
        lockedAt: new Date(),
        sentAt: current.sentAt || new Date()
      }
    });

    const batchSize = Math.min(Math.max(parseInt(req.body?.batchSize, 10) || 50, 1), 100);
    const result = await processCampaignBatch(id, { batchSize });

    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error, campaign: result.campaign });
    }

    return res.json(result);
  } catch (err) {
    console.error("POST /campaigns/:id/send failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /campaigns/:id/pause — Pause a sending or scheduled campaign
router.post("/campaigns/:id/pause", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const result = await pauseCampaign(id, workspaceId);
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error("POST /campaigns/:id/pause failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /campaigns/:id/resume — Resume a paused campaign
router.post("/campaigns/:id/resume", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const batchSize = Math.min(Math.max(parseInt(req.body?.batchSize, 10) || 50, 1), 100);
    const result = await resumeCampaign(id, workspaceId, { batchSize });
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error("POST /campaigns/:id/resume failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /campaigns/:id/retry-failed — Retry eligible failed recipients
router.post("/campaigns/:id/retry-failed", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const batchSize = Math.min(Math.max(parseInt(req.body?.batchSize, 10) || 50, 1), 100);
    const result = await retryFailedRecipients(id, workspaceId, { batchSize });
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error("POST /campaigns/:id/retry-failed failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /campaigns/process-due — Trigger automatic processing of due scheduled campaigns
router.post("/campaigns/process-due", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  try {
    const result = await processDueCampaigns();
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("POST /campaigns/process-due failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
