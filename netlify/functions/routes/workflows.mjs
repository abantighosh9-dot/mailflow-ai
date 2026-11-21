// Automation & Drip Workflows API for MailFlow AI
import express from "express";
import { prisma } from "../_lib/db.mjs";
import { auth as requireAuth, requireRole } from "../_lib/auth.mjs";
import { calculateNextExecutionTime } from "../_lib/workflow-runner.mjs";
import { z } from "zod";

const router = express.Router();

// Validation schemas (Zod 4.1)
const workflowStepSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["EMAIL", "DELAY", "CONDITION"]).default("EMAIL"),
  name: z.string().trim().max(100).optional().nullable(),
  config: z.record(z.any()).default({})
});

const workflowCreateSchema = z.object({
  name: z.string().trim().min(1, "Workflow name is required").max(200, "Name too long"),
  description: z.string().trim().max(1000).optional().nullable(),
  type: z.string().trim().max(50).optional().default("DRIP"),
  triggerType: z.enum(["CONTACT_SUBSCRIBED", "TAG_ADDED"]).default("CONTACT_SUBSCRIBED"),
  triggerConfig: z.record(z.any()).optional().default({}),
  active: z.boolean().optional().default(false),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  steps: z.array(workflowStepSchema).optional().default([])
});

const workflowPatchSchema = z.object({
  name: z.string().trim().min(1, "Workflow name cannot be empty").max(200).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  type: z.string().trim().max(50).optional(),
  triggerType: z.enum(["CONTACT_SUBSCRIBED", "TAG_ADDED"]).optional(),
  triggerConfig: z.record(z.any()).optional(),
  active: z.boolean().optional(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  steps: z.array(workflowStepSchema).optional()
});

const enrollSchema = z.object({
  contactId: z.string().optional(),
  contactIds: z.array(z.string()).optional()
}).refine(data => Boolean(data.contactId || (data.contactIds && data.contactIds.length > 0)), {
  message: "Either contactId or contactIds must be provided."
});

// GET /workflows — List workflows for authenticated workspace
router.get("/workflows", requireAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) return res.status(401).json({ error: "Workspace context missing." });

  const { page = "1", limit = "20", q = "", status, triggerType } = req.query;
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
        { description: { contains: search, mode: "insensitive" } }
      ]
    });
  }

  if (status === "active") and.push({ active: true });
  if (status === "paused" || status === "draft") and.push({ active: false });

  if (triggerType && ["CONTACT_SUBSCRIBED", "TAG_ADDED"].includes(triggerType)) {
    and.push({ triggerType });
  }

  if (and.length > 0) where.AND = and;

  try {
    const [workflows, total] = await Promise.all([
      prisma.workflow.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: "desc" },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          _count: {
            select: {
              steps: true,
              enrollments: true
            }
          }
        }
      }),
      prisma.workflow.count({ where })
    ]);

    // Enhance with active and completed enrollment counts
    const workflowIds = workflows.map(w => w.id);
    const enrollmentStats = await prisma.workflowEnrollment.groupBy({
      by: ["workflowId", "status"],
      where: { workflowId: { in: workflowIds } },
      _count: { id: true }
    });

    const statsMap = {};
    for (const stat of enrollmentStats) {
      if (!statsMap[stat.workflowId]) {
        statsMap[stat.workflowId] = { active: 0, completed: 0, failed: 0 };
      }
      if (stat.status === "ACTIVE") statsMap[stat.workflowId].active = stat._count.id;
      if (stat.status === "COMPLETED") statsMap[stat.workflowId].completed = stat._count.id;
      if (stat.status === "FAILED") statsMap[stat.workflowId].failed = stat._count.id;
    }

    const enhanced = workflows.map(w => ({
      ...w,
      stepsCount: w._count.steps,
      enrollmentsCount: w._count.enrollments,
      activeEnrollments: statsMap[w.id]?.active || 0,
      completedEnrollments: statsMap[w.id]?.completed || 0,
      failedEnrollments: statsMap[w.id]?.failed || 0
    }));

    return res.json({
      workflows: enhanced,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum)
    });
  } catch (err) {
    console.error("GET /workflows failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /workflows/:id — Detailed workflow view with steps
router.get("/workflows/:id", requireAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const workflow = await prisma.workflow.findFirst({
      where: { id, workspaceId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        steps: { orderBy: { stepOrder: "asc" } },
        _count: { select: { enrollments: true } }
      }
    });

    if (!workflow) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    // Enrollment breakdown
    const stats = await prisma.workflowEnrollment.groupBy({
      by: ["status"],
      where: { workflowId: id },
      _count: { id: true }
    });

    const statusCounts = { active: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const s of stats) {
      if (s.status === "ACTIVE") statusCounts.active = s._count.id;
      if (s.status === "COMPLETED") statusCounts.completed = s._count.id;
      if (s.status === "FAILED") statusCounts.failed = s._count.id;
      if (s.status === "CANCELLED") statusCounts.cancelled = s._count.id;
    }

    return res.json({
      workflow: {
        ...workflow,
        stats: statusCounts
      }
    });
  } catch (err) {
    console.error("GET /workflows/:id failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /workflows — Create a new workflow
router.post("/workflows", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) return res.status(401).json({ error: "Workspace context missing." });

  const parseResult = workflowCreateSchema.safeParse(req.body);
  if (!parseResult.success) {
    const message = parseResult.error.issues.map(i => i.message).join(", ");
    return res.status(400).json({ error: message });
  }

  const { name, description, type, triggerType, triggerConfig, active, startDate, endDate, steps = [] } = parseResult.data;

  try {
    const workflow = await prisma.$transaction(async tx => {
      const created = await tx.workflow.create({
        data: {
          workspaceId,
          createdById: req.user?.id || null,
          name,
          description,
          type,
          triggerType,
          triggerConfig: triggerConfig || {},
          active: Boolean(active),
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null
        }
      });

      if (steps.length > 0) {
        await Promise.all(
          steps.map((step, index) =>
            tx.workflowStep.create({
              data: {
                workflowId: created.id,
                stepOrder: index,
                type: step.type || "EMAIL",
                name: step.name || `${step.type} Step ${index + 1}`,
                config: step.config || {}
              }
            })
          )
        );
      }

      return tx.workflow.findUnique({
        where: { id: created.id },
        include: { steps: { orderBy: { stepOrder: "asc" } } }
      });
    });

    return res.status(201).json({ workflow });
  } catch (err) {
    console.error("POST /workflows failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /workflows/:id — Update workflow and sync steps
router.patch("/workflows/:id", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const existing = await prisma.workflow.findFirst({
      where: { id, workspaceId }
    });

    if (!existing) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    const parseResult = workflowPatchSchema.safeParse(req.body);
    if (!parseResult.success) {
      const message = parseResult.error.issues.map(i => i.message).join(", ");
      return res.status(400).json({ error: message });
    }

    const data = parseResult.data;

    const updated = await prisma.$transaction(async tx => {
      const updateData = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.type !== undefined) updateData.type = data.type;
      if (data.triggerType !== undefined) updateData.triggerType = data.triggerType;
      if (data.triggerConfig !== undefined) updateData.triggerConfig = data.triggerConfig;
      if (data.active !== undefined) updateData.active = data.active;
      if (data.startDate !== undefined) updateData.startDate = data.startDate ? new Date(data.startDate) : null;
      if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;

      await tx.workflow.update({
        where: { id },
        data: updateData
      });

      // Synchronize steps if provided
      if (Array.isArray(data.steps)) {
        await tx.workflowStep.deleteMany({ where: { workflowId: id } });

        await Promise.all(
          data.steps.map((s, index) =>
            tx.workflowStep.create({
              data: {
                workflowId: id,
                stepOrder: index,
                type: s.type || "EMAIL",
                name: s.name || `${s.type} Step ${index + 1}`,
                config: s.config || {}
              }
            })
          )
        );
      }

      return tx.workflow.findUnique({
        where: { id },
        include: { steps: { orderBy: { stepOrder: "asc" } } }
      });
    });

    return res.json({ workflow: updated });
  } catch (err) {
    console.error("PATCH /workflows/:id failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /workflows/:id — Delete workflow and related records
router.delete("/workflows/:id", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const existing = await prisma.workflow.findFirst({
      where: { id, workspaceId }
    });

    if (!existing) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    await prisma.workflow.delete({ where: { id } });
    return res.status(204).end();
  } catch (err) {
    console.error("DELETE /workflows/:id failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /workflows/:id/toggle — Toggle active/paused status
router.post("/workflows/:id/toggle", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  try {
    const workflow = await prisma.workflow.findFirst({
      where: { id, workspaceId },
      include: { steps: true }
    });

    if (!workflow) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    // Guard: cannot activate a workflow with 0 steps
    if (!workflow.active && workflow.steps.length === 0) {
      return res.status(400).json({
        error: "Workflow must have at least one step configured before it can be activated."
      });
    }

    const updated = await prisma.workflow.update({
      where: { id },
      data: { active: !workflow.active },
      include: { steps: { orderBy: { stepOrder: "asc" } } }
    });

    return res.json({
      workflow: updated,
      message: updated.active ? "Workflow activated successfully." : "Workflow paused."
    });
  } catch (err) {
    console.error("POST /workflows/:id/toggle failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /workflows/:id/enroll — Manually enroll contact(s) into workflow
router.post("/workflows/:id/enroll", requireAuth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;

  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid enrollment payload." });
  }

  const { contactId, contactIds } = parsed.data;
  const targetIds = contactIds || (contactId ? [contactId] : []);

  try {
    const workflow = await prisma.workflow.findFirst({
      where: { id, workspaceId },
      include: { steps: { orderBy: { stepOrder: "asc" } } }
    });

    if (!workflow) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    if (workflow.steps.length === 0) {
      return res.status(400).json({ error: "Cannot enroll contacts in a workflow with no steps." });
    }

    const contacts = await prisma.contact.findMany({
      where: {
        id: { in: targetIds },
        workspaceId,
        status: "SUBSCRIBED" // Strict compliance guard
      }
    });

    const firstStep = workflow.steps[0];
    const now = new Date();
    const nextExec = calculateNextExecutionTime(firstStep, now);

    let enrolledCount = 0;
    let skippedCount = 0;

    for (const c of contacts) {
      try {
        await prisma.workflowEnrollment.create({
          data: {
            workflowId: id,
            contactId: c.id,
            status: "ACTIVE",
            currentStepId: firstStep.id,
            nextExecutionAt: nextExec,
            enrolledAt: now
          }
        });
        enrolledCount++;
      } catch (e) {
        if (e.code === "P2002") {
          skippedCount++; // Already enrolled
        } else {
          throw e;
        }
      }
    }

    return res.json({
      success: true,
      enrolledCount,
      skippedCount,
      message: `Enrolled ${enrolledCount} contact(s) into "${workflow.name}". ${skippedCount > 0 ? `${skippedCount} already enrolled or skipped.` : ""}`
    });
  } catch (err) {
    console.error("POST /workflows/:id/enroll failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /workflows/:id/enrollments — List contacts enrolled in this workflow
router.get("/workflows/:id/enrollments", requireAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { id } = req.params;
  const { page = "1", limit = "20", status } = req.query;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  try {
    const workflow = await prisma.workflow.findFirst({
      where: { id, workspaceId }
    });

    if (!workflow) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    const where = { workflowId: id };
    if (status && ["ACTIVE", "COMPLETED", "PAUSED", "FAILED", "CANCELLED"].includes(status.toUpperCase())) {
      where.status = status.toUpperCase();
    }

    const [enrollments, total] = await Promise.all([
      prisma.workflowEnrollment.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { enrolledAt: "desc" },
        include: {
          contact: {
            select: { id: true, email: true, firstName: true, lastName: true, company: true, status: true }
          },
          executions: {
            orderBy: { executedAt: "desc" },
            take: 5
          }
        }
      }),
      prisma.workflowEnrollment.count({ where })
    ]);

    return res.json({
      enrollments,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum)
    });
  } catch (err) {
    console.error("GET /workflows/:id/enrollments failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
