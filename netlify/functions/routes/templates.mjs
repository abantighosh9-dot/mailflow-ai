// MailFlow AI — Email Template Management Backend Routes
import express from "express";
import { z } from "zod";
import { prisma } from "../_lib/db.mjs";
import { auth, requireRole } from "../_lib/auth.mjs";
import { STARTER_TEMPLATES, TEMPLATE_CATEGORIES } from "../_lib/starter-templates.mjs";

const router = express.Router();

/**
 * Validation schema for creating an email template.
 */
export const createTemplateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required").max(120, "Template name cannot exceed 120 characters"),
  subject: z.string().trim().optional().default(""),
  previewText: z.string().trim().optional().nullable(),
  category: z.string().trim().optional().default("Custom"),
  html: z.string().min(1, "Template HTML content cannot be empty"),
  content: z.record(z.any()).optional()
});

/**
 * Validation schema for updating an email template.
 */
export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1, "Template name cannot be empty").max(120, "Template name cannot exceed 120 characters").optional(),
  subject: z.string().trim().optional(),
  previewText: z.string().trim().optional().nullable(),
  category: z.string().trim().optional(),
  html: z.string().min(1, "Template HTML content cannot be empty").optional(),
  content: z.record(z.any()).optional()
});

/**
 * Normalizes template input, supporting both standard payload and legacy EmailStudio format.
 */
function normalizeTemplateInput(body = {}) {
  const name = body.name ? String(body.name).trim() : "";
  const emailObj = body.email && typeof body.email === "object" ? body.email : null;

  const subject = emailObj ? (emailObj.subject || "") : (body.subject || "");
  const previewText = emailObj ? (emailObj.previewText || null) : (body.previewText || null);
  const html = emailObj ? (emailObj.html || "") : (body.html || "");
  const category = body.category && String(body.category).trim() ? String(body.category).trim() : "Custom";

  let content = body.content || emailObj || {};
  if (typeof content !== "object" || content === null) {
    content = {};
  }
  content = { ...content, category };

  return { name, subject, previewText, category, html, content };
}

/**
 * Enriches a Prisma template record by extracting the category.
 */
export function formatTemplate(t) {
  if (!t) return null;
  const contentObj = (t.content && typeof t.content === "object") ? t.content : {};
  return {
    ...t,
    category: contentObj.category || "Custom"
  };
}

// =========================================================================
// 1. GET /templates/starters — Built-in starter templates collection
// =========================================================================
router.get("/templates/starters", auth, async (_req, res) => {
  return res.json({
    starters: STARTER_TEMPLATES,
    categories: TEMPLATE_CATEGORIES
  });
});

// =========================================================================
// 2. GET /templates — List workspace templates with search & category filters
// =========================================================================
router.get("/templates", auth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(400).json({ error: "Workspace context is missing." });
  }

  const { search, category } = req.query;

  try {
    const where = { workspaceId };

    if (search && String(search).trim()) {
      const term = String(search).trim();
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { subject: { contains: term, mode: "insensitive" } }
      ];
    }

    const templates = await prisma.emailTemplate.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { campaigns: true }
        }
      }
    });

    let formatted = templates.map(formatTemplate);

    // Filter by category if specified and not "All"
    if (category && String(category).trim() && String(category).trim().toLowerCase() !== "all") {
      const catLower = String(category).trim().toLowerCase();
      formatted = formatted.filter(t => t.category.toLowerCase() === catLower);
    }

    return res.json({
      templates: formatted,
      categories: TEMPLATE_CATEGORIES
    });
  } catch (err) {
    console.error("GET /templates failed:", err);
    return res.status(500).json({ error: "Failed to load templates." });
  }
});

// =========================================================================
// 3. GET /templates/:id — Get specific template details
// =========================================================================
router.get("/templates/:id", auth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const template = await prisma.emailTemplate.findFirst({
      where: { id, workspaceId },
      include: {
        _count: {
          select: { campaigns: true }
        }
      }
    });

    if (!template) {
      return res.status(404).json({ error: "Template not found." });
    }

    return res.json({ template: formatTemplate(template) });
  } catch (err) {
    console.error(`GET /templates/${id} failed:`, err);
    return res.status(500).json({ error: "Failed to load template." });
  }
});

// =========================================================================
// 4. POST /templates — Create a new template in workspace
// =========================================================================
router.post("/templates", auth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(400).json({ error: "Workspace context is missing." });
  }

  try {
    const normalized = normalizeTemplateInput(req.body);
    const parsed = createTemplateSchema.safeParse(normalized);

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues?.[0]?.message || parsed.error.errors?.[0]?.message || "Invalid template data."
      });
    }

    const { name, subject, previewText, category, html, content } = parsed.data;

    const saved = await prisma.emailTemplate.create({
      data: {
        workspaceId,
        name,
        subject,
        previewText: previewText || null,
        html,
        content: {
          category,
          ...(content || {})
        }
      }
    });

    return res.status(201).json({
      template: formatTemplate(saved),
      message: "Template created successfully."
    });
  } catch (err) {
    console.error("POST /templates failed:", err);
    return res.status(500).json({ error: "Failed to create template." });
  }
});

// =========================================================================
// 5. PATCH /templates/:id — Update template details and HTML content
// =========================================================================
router.patch("/templates/:id", auth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const existing = await prisma.emailTemplate.findFirst({
      where: { id, workspaceId }
    });

    if (!existing) {
      return res.status(404).json({ error: "Template not found." });
    }

    const parsed = updateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues?.[0]?.message || parsed.error.errors?.[0]?.message || "Invalid update data."
      });
    }

    const updates = parsed.data;
    const existingContent = (existing.content && typeof existing.content === "object") ? existing.content : {};

    const updatedContent = {
      ...existingContent,
      ...(updates.content || {})
    };

    if (updates.category) {
      updatedContent.category = updates.category;
    }

    const updated = await prisma.emailTemplate.update({
      where: { id },
      data: {
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.subject !== undefined ? { subject: updates.subject } : {}),
        ...(updates.previewText !== undefined ? { previewText: updates.previewText || null } : {}),
        ...(updates.html !== undefined ? { html: updates.html } : {}),
        content: updatedContent
      }
    });

    return res.json({
      template: formatTemplate(updated),
      message: "Template updated successfully."
    });
  } catch (err) {
    console.error(`PATCH /templates/${id} failed:`, err);
    return res.status(500).json({ error: "Failed to update template." });
  }
});

// =========================================================================
// 6. DELETE /templates/:id — Delete template safely
// =========================================================================
router.delete("/templates/:id", auth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const existing = await prisma.emailTemplate.findFirst({
      where: { id, workspaceId }
    });

    if (!existing) {
      return res.status(404).json({ error: "Template not found." });
    }

    // Check if any in-flight or scheduled campaigns reference this template
    const activeCampaignCount = await prisma.campaign.count({
      where: {
        templateId: id,
        workspaceId,
        status: { in: ["SCHEDULED", "SENDING", "QUEUED"] }
      }
    });

    if (activeCampaignCount > 0) {
      return res.status(400).json({
        error: `Cannot delete template: it is currently referenced by ${activeCampaignCount} scheduled or sending campaign(s).`
      });
    }

    // Safely unlink any remaining draft or completed campaigns before deleting
    await prisma.campaign.updateMany({
      where: { templateId: id, workspaceId },
      data: { templateId: null }
    });

    await prisma.emailTemplate.delete({
      where: { id }
    });

    return res.json({
      success: true,
      message: "Template deleted successfully."
    });
  } catch (err) {
    console.error(`DELETE /templates/${id} failed:`, err);
    return res.status(500).json({ error: "Failed to delete template." });
  }
});

// =========================================================================
// 7. POST /templates/:id/duplicate — Duplicate an existing template
// =========================================================================
router.post("/templates/:id/duplicate", auth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const original = await prisma.emailTemplate.findFirst({
      where: { id, workspaceId }
    });

    if (!original) {
      return res.status(404).json({ error: "Template not found." });
    }

    const baseName = original.name.replace(/\s*\(Copy\b.*?\)?$/i, "").trim();
    const copyName = `${baseName} (Copy)`.slice(0, 120);

    const duplicate = await prisma.emailTemplate.create({
      data: {
        workspaceId,
        name: copyName,
        subject: original.subject,
        previewText: original.previewText,
        html: original.html,
        content: original.content || {}
      }
    });

    return res.status(201).json({
      template: formatTemplate(duplicate),
      message: `Template duplicated as "${copyName}".`
    });
  } catch (err) {
    console.error(`POST /templates/${id}/duplicate failed:`, err);
    return res.status(500).json({ error: "Failed to duplicate template." });
  }
});

export default router;
