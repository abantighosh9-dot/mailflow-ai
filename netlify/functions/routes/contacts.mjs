// Contacts routes for MailFlow AI
import express from "express";
import { prisma } from "../_lib/db.mjs";
import { auth as requireAuth, requireRole, checkLoginThrottle } from "../_lib/auth.mjs";
import { triggerWorkflowsForContact } from "../_lib/workflow-runner.mjs";
import { z } from "zod";

const router = express.Router();

// Validation schemas
const contactCreateSchema = z.object({
  email: z.string().email().transform(v => v.trim().toLowerCase()),
  firstName: z.string().optional().transform(v => v?.trim()),
  lastName: z.string().optional().transform(v => v?.trim()),
  company: z.string().optional().transform(v => v?.trim()),
  tags: z.array(z.string().transform(t => t.trim().toLowerCase())).max(20).optional()
});

function contactWhere(workspaceId, { q = "", status, tag } = {}) {
  const where = { workspaceId };
  const and = [];
  const search = String(q || "").trim();
  if (search) and.push({ OR: [
    { email: { contains: search, mode: "insensitive" } },
    { firstName: { contains: search, mode: "insensitive" } },
    { lastName: { contains: search, mode: "insensitive" } },
    { company: { contains: search, mode: "insensitive" } }
  ] });
  if (["SUBSCRIBED", "UNSUBSCRIBED", "BOUNCED", "COMPLAINED"].includes(status)) and.push({ status });
  if (typeof tag === "string" && tag.trim()) and.push({ tags: { has: tag.trim().toLowerCase() } });
  if (and.length) where.AND = and;
  return where;
}

function csvCell(value) {
  let text = value == null ? "" : Array.isArray(value) ? value.join(", ") : value instanceof Date ? value.toISOString() : String(value);
  if (/^[\u0000-\u0020]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const contactPatchSchema = z.object({
  firstName: z.string().optional().transform(v => v?.trim()),
  lastName: z.string().optional().transform(v => v?.trim()),
  company: z.string().optional().transform(v => v?.trim()),
  tags: z.array(z.string().transform(t => t.trim().toLowerCase())).max(20).optional(),
  status: z.enum(["SUBSCRIBED","UNSUBSCRIBED","BOUNCED","COMPLAINED"]).optional()
});

// GET /contacts
router.get("/contacts", requireAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { page = "1", limit = "20", q = "", status, tag } = req.query;
  const pageNum = Math.max(parseInt(page), 1);
  const limitNum = Math.min(Math.max(parseInt(limit), 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const where = contactWhere(workspaceId, { q, status, tag });

  try {
    const [contacts, total, stats] = await Promise.all([
      prisma.contact.findMany({ where, skip, take: limitNum, orderBy: { createdAt: "desc" } }),
      prisma.contact.count({ where }),
      prisma.contact.groupBy({
        by: ["status"],
        where: { workspaceId },
        _count: { status: true }
      })
    ]);
    const statsMap = {};
    stats.forEach(s => (statsMap[s.status] = s._count.status));
    const response = {
      contacts,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      stats: {
        total,
        subscribed: statsMap["SUBSCRIBED"] ?? 0,
        unsubscribed: statsMap["UNSUBSCRIBED"] ?? 0,
        bounced: statsMap["BOUNCED"] ?? 0,
        complained: statsMap["COMPLAINED"] ?? 0
      }
    };
    res.json(response);
  } catch (e) {
    console.error("GET /contacts failed", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /contacts/tags
router.get("/contacts/tags", requireAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  try {
    const tags = await prisma.contact.findMany({
      where: { workspaceId },
      select: { tags: true }
    });
    const distinct = Array.from(new Set(tags.flatMap(t => t.tags)));
    res.json({ tags: distinct });
  } catch (e) {
    console.error("GET /contacts/tags failed", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /contacts/import
router.post("/contacts/import", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const { rows, consentConfirmed } = req.body;
  if (!consentConfirmed) return res.status(400).json({ error: "Consent not confirmed" });
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "No rows provided" });
  if (rows.length > 500) return res.status(400).json({ error: "Maximum 500 rows per request" });
  const workspaceId = req.workspace?.id;
  const valid = [];
  const invalid = [];
  const seen = new Set();
  let duplicates = 0;
  for (let i = 0; i < rows.length; i++) {
    const parse = contactCreateSchema.safeParse(rows[i]);
    if (!parse.success) {
      invalid.push({ row: i + 1, email: rows[i]?.email ?? "", reason: parse.error.issues.map(issue => issue.message).join(", ") });
      continue;
    }
    const { email } = parse.data;
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    valid.push({ ...parse.data, workspaceId, source: "import", consentAt: new Date() });
  }
  let imported = 0;
  try {
    for (let i = 0; i < valid.length; i += 500) {
      const chunk = valid.slice(i, i + 500);
      const result = await prisma.contact.createMany({ data: chunk, skipDuplicates: true });
      imported += result.count;
      duplicates += chunk.length - result.count;
    }
  } catch (e) {
    console.error("POST /contacts/import failed", e);
    return res.status(500).json({ error: "Internal server error" });
  }
  res.json({ imported, duplicates, invalid });
});

// POST /contacts/bulk
router.post("/contacts/bulk", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const { action, ids, tag } = req.body;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) {
    return res.status(400).json({ error: "ids must be an array with 1-500 elements" });
  }
  const workspaceId = req.workspace?.id;
  try {
    let affected = 0;
    switch (action) {
      case "delete":
        const del = await prisma.contact.deleteMany({ where: { id: { in: ids }, workspaceId } });
        affected = del.count;
        break;
      case "addTag":
        if (!tag || typeof tag !== "string" || tag.trim() === "") {
          return res.status(400).json({ error: "tag required and must be non‑empty string" });
        }
        {
          const cleanTag = tag.trim().toLowerCase();
          const selected = await prisma.contact.findMany({ where: { id: { in: ids }, workspaceId }, select: { id: true, tags: true } });
          for (const contact of selected) {
            if (!contact.tags.includes(cleanTag)) {
              await prisma.contact.updateMany({ where: { id: contact.id, workspaceId }, data: { tags: [...contact.tags, cleanTag] } });
              triggerWorkflowsForContact({
                workspaceId,
                contactId: contact.id,
                event: "TAG_ADDED",
                data: { tag: cleanTag }
              }).catch(e => console.error("Workflow bulk tag trigger error:", e));
            }
          }
          affected = selected.length;
        }
        break;
      case "removeTag":
        if (!tag || typeof tag !== "string" || tag.trim() === "") {
          return res.status(400).json({ error: "tag required and must be non‑empty string" });
        }
        {
          const selected = await prisma.contact.findMany({ where: { id: { in: ids }, workspaceId }, select: { id: true, tags: true } });
          for (const contact of selected) await prisma.contact.updateMany({ where: { id: contact.id, workspaceId }, data: { tags: contact.tags.filter(value => value !== tag.trim().toLowerCase()) } });
          affected = selected.length;
        }
        break;
      case "unsubscribe":
        const unsub = await prisma.contact.updateMany({
          // Preserve bounced and complained suppression reasons.
          where: { id: { in: ids }, workspaceId, status: "SUBSCRIBED" },
          data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() }
        });
        affected = unsub.count;
        break;
      default:
        return res.status(400).json({ error: "Invalid action" });
    }
    res.json({ affected });
  } catch (e) {
    console.error("POST /contacts/bulk failed", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /contacts/export
router.get("/contacts/export", requireAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  try {
    const contacts = await prisma.contact.findMany({ where: contactWhere(workspaceId, req.query), orderBy: { createdAt: "desc" } });
    const headers = ["email", "firstName", "lastName", "company", "status", "tags", "createdAt", "source", "consentAt"];
    const csv = [headers.map(csvCell).join(","), ...contacts.map(c => headers.map(h => csvCell(c[h])).join(","))].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="contacts.csv"');
    res.send(csv);
  } catch (e) {
    console.error("GET /contacts/export failed", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /contacts
router.post("/contacts", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const parseResult = contactCreateSchema.safeParse(req.body);
  if (!parseResult.success) return res.status(400).json({ error: parseResult.error.issues.map(i=>i.message).join(", ") });
  const data = parseResult.data;
  const workspaceId = req.workspace?.id;
  try {
    const contact = await prisma.contact.create({
      data: {
        workspaceId,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        company: data.company,
        tags: data.tags ?? [],
        source: "manual",
        consentAt: new Date()
      }
    });

    // Fire automated workflow triggers asynchronously
    triggerWorkflowsForContact({
      workspaceId,
      contactId: contact.id,
      event: "CONTACT_SUBSCRIBED"
    }).catch(e => console.error("Workflow trigger error:", e));

    if (Array.isArray(contact.tags) && contact.tags.length > 0) {
      for (const tag of contact.tags) {
        triggerWorkflowsForContact({
          workspaceId,
          contactId: contact.id,
          event: "TAG_ADDED",
          data: { tag }
        }).catch(e => console.error("Workflow tag trigger error:", e));
      }
    }

    res.status(201).json(contact);
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Contact with this email already exists in workspace" });
    }
    console.error("POST /contacts failed", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /contacts/:id
router.patch("/contacts/:id", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const parseResult = contactPatchSchema.safeParse(req.body);
  if (!parseResult.success) return res.status(400).json({ error: parseResult.error.issues.map(i=>i.message).join(", ") });
  const data = parseResult.data;
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  const current = await prisma.contact.findFirst({ where: { id, workspaceId } });
  if (!current) return res.status(404).json({ error: "Contact not found." });

  if (data.status === "SUBSCRIBED") {
    if (current.status === "UNSUBSCRIBED") {
      return res.status(400).json({ error: "This contact unsubscribed and must re-subscribe themselves." });
    }
    if (["BOUNCED","COMPLAINED"].includes(current.status)) {
      return res.status(400).json({ error: "This contact cannot be re-subscribed." });
    }
  }

  if (data.status === "UNSUBSCRIBED" && current.status !== "UNSUBSCRIBED") {
    data.unsubscribedAt = new Date();
  }

  try {
    await prisma.contact.updateMany({ where: { id, workspaceId }, data });
    const updated = await prisma.contact.findFirst({ where: { id, workspaceId } });

    // Trigger workflows for newly added tags
    if (Array.isArray(data.tags)) {
      const currentTags = current.tags || [];
      const addedTags = data.tags.filter(t => !currentTags.includes(t));
      for (const t of addedTags) {
        triggerWorkflowsForContact({
          workspaceId,
          contactId: id,
          event: "TAG_ADDED",
          data: { tag: t }
        }).catch(e => console.error("Workflow tag trigger error:", e));
      }
    }

    res.json(updated);
  } catch (e) {
    console.error("PATCH /contacts/:id failed", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /contacts/:id
router.delete("/contacts/:id", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;
  try {
    await prisma.contact.delete({ where: { id, workspaceId } });
    res.status(204).end();
  } catch (e) {
    if (e.code === "P2025") return res.status(404).json({ error: "Contact not found" });
    console.error("DELETE /contacts/:id failed", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
