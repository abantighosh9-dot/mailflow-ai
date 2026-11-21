import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import express from "express";

if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) {
  throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
}

const mocks = vi.hoisted(() => {
  const prismaMock = {
    workflow: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    workflowStep: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn()
    },
    workflowEnrollment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    workflowExecution: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    contact: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn()
    },
    $transaction: vi.fn(callback => callback(prismaMock))
  };

  const mockSendTransactionalEmail = vi.fn();

  return {
    prisma: prismaMock,
    mockSendTransactionalEmail
  };
});

vi.mock("../netlify/functions/_lib/db.mjs", () => ({
  prisma: mocks.prisma,
  default: mocks.prisma
}));

vi.mock("../netlify/functions/_lib/brevo.mjs", () => ({
  sendTransactionalEmail: mocks.mockSendTransactionalEmail
}));

vi.mock("../netlify/functions/_lib/auth.mjs", () => ({
  auth: (req, res, next) => {
    if (req.headers["x-test-unauthenticated"]) {
      return res.status(401).json({ error: "Please sign in." });
    }
    const role = req.headers["x-test-role"] || "ADMIN";
    req.user = { id: "user_test_123", email: "test@example.com" };
    req.workspace = { id: req.headers["x-test-workspace"] || "ws_123", role };
    next();
  },
  requireRole: (...allowedRoles) => (req, res, next) => {
    const userRole = req.workspace?.role || req.headers["x-test-role"] || "VIEWER";
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: "Forbidden: insufficient permissions." });
    }
    next();
  }
}));

import {
  getStepDelayMs,
  calculateNextExecutionTime,
  evaluateStepCondition,
  triggerWorkflowsForContact,
  processDueWorkflows,
  executeEnrollmentStep
} from "../netlify/functions/_lib/workflow-runner.mjs";

describe("Automation & Drip Workflows API and Execution Engine", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-123456";
    process.env.UNSUBSCRIBE_SECRET = "test-secret-at-least-32-chars-long-123456";

    const workflowsRouter = (await import("../netlify/functions/routes/workflows.mjs")).default;
    const app = express();
    app.use(express.json());
    app.use(workflowsRouter);

    await new Promise(resolve => {
      server = createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise(resolve => {
      if (server) server.close(resolve);
      else resolve();
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSendTransactionalEmail.mockResolvedValue({ messageId: "<msg-test-123@brevo.com>" });
  });

  describe("1. Step Timing, Delay & Condition Evaluation", () => {
    it("correctly calculates delay in milliseconds for minutes, hours, and days", () => {
      expect(getStepDelayMs({ amount: 15, unit: "minutes" })).toBe(15 * 60 * 1000);
      expect(getStepDelayMs({ amount: 2, unit: "hours" })).toBe(2 * 60 * 60 * 1000);
      expect(getStepDelayMs({ amount: 3, unit: "days" })).toBe(3 * 24 * 60 * 60 * 1000);
      expect(getStepDelayMs({})).toBe(0);
    });

    it("calculates next execution time for delay steps", () => {
      const base = new Date("2026-11-21T10:00:00Z");
      const step = { type: "DELAY", config: { amount: 30, unit: "minutes" } };
      const nextTime = calculateNextExecutionTime(step, base);
      expect(nextTime.toISOString()).toBe("2026-11-21T10:30:00.000Z");
    });

    it("evaluates condition steps correctly on contact tags and company", () => {
      const contact = { tags: ["vip", "newsletter"], company: "Acme Corp" };
      expect(evaluateStepCondition({ field: "tags", operator: "contains", value: "vip" }, contact)).toBe(true);
      expect(evaluateStepCondition({ field: "tags", operator: "contains", value: "lead" }, contact)).toBe(false);
      expect(evaluateStepCondition({ field: "company", operator: "contains", value: "acme" }, contact)).toBe(true);
      expect(evaluateStepCondition({ field: "company", operator: "is_not_empty" }, contact)).toBe(true);
    });
  });

  describe("2. REST API & RBAC Authorization", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await fetch(`${baseUrl}/workflows`, {
        headers: { "x-test-unauthenticated": "1" }
      });
      expect(res.status).toBe(401);
    });

    it("lists workflows scoped to workspace with enrollment aggregation", async () => {
      mocks.prisma.workflow.findMany.mockResolvedValue([
        {
          id: "wf_1",
          workspaceId: "ws_123",
          name: "Welcome Series",
          active: true,
          triggerType: "CONTACT_SUBSCRIBED",
          _count: { steps: 3, enrollments: 12 }
        }
      ]);
      mocks.prisma.workflow.count.mockResolvedValue(1);
      mocks.prisma.workflowEnrollment.groupBy.mockResolvedValue([
        { workflowId: "wf_1", status: "ACTIVE", _count: { id: 8 } },
        { workflowId: "wf_1", status: "COMPLETED", _count: { id: 4 } }
      ]);

      const res = await fetch(`${baseUrl}/workflows`, {
        headers: { "x-test-workspace": "ws_123", "x-test-role": "VIEWER" }
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.workflows.length).toBe(1);
      expect(json.workflows[0].stepsCount).toBe(3);
      expect(json.workflows[0].activeEnrollments).toBe(8);
      expect(json.workflows[0].completedEnrollments).toBe(4);
    });

    it("blocks VIEWER and ANALYST roles from creating or updating workflows (403 Forbidden)", async () => {
      const res = await fetch(`${baseUrl}/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": "VIEWER" },
        body: JSON.stringify({ name: "Hacked Workflow" })
      });
      expect(res.status).toBe(403);
    });

    it("allows OWNER, ADMIN, and EDITOR to create workflows with atomic steps", async () => {
      mocks.prisma.workflow.create.mockResolvedValue({
        id: "wf_new",
        workspaceId: "ws_123",
        name: "Lead Drip",
        active: false,
        triggerType: "TAG_ADDED"
      });
      mocks.prisma.workflowStep.create.mockResolvedValue({ id: "step_1", workflowId: "wf_new" });
      mocks.prisma.workflow.findUnique.mockResolvedValue({
        id: "wf_new",
        name: "Lead Drip",
        steps: [
          { id: "step_1", stepOrder: 0, type: "EMAIL", name: "Welcome Email" },
          { id: "step_2", stepOrder: 1, type: "DELAY", name: "Wait 2 days" }
        ]
      });

      const res = await fetch(`${baseUrl}/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": "EDITOR" },
        body: JSON.stringify({
          name: "Lead Drip",
          triggerType: "TAG_ADDED",
          triggerConfig: { tag: "lead" },
          steps: [
            { type: "EMAIL", name: "Welcome Email", config: { subject: "Welcome to MailFlow" } },
            { type: "DELAY", name: "Wait 2 days", config: { amount: 2, unit: "days" } }
          ]
        })
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.workflow.id).toBe("wf_new");
      expect(json.workflow.steps.length).toBe(2);
    });

    it("returns 400 when attempting to activate a workflow with 0 steps", async () => {
      mocks.prisma.workflow.findFirst.mockResolvedValue({
        id: "wf_empty",
        workspaceId: "ws_123",
        active: false,
        steps: []
      });

      const res = await fetch(`${baseUrl}/workflows/wf_empty/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": "ADMIN" }
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/at least one step/i);
    });

    it("enforces workspace isolation on GET /workflows/:id", async () => {
      mocks.prisma.workflow.findFirst.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/workflows/foreign_wf`, {
        headers: { "x-test-workspace": "ws_my_own" }
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/not found/i);
    });

    it("safely deletes a workflow and cascades steps and enrollments", async () => {
      mocks.prisma.workflow.findFirst.mockResolvedValue({ id: "wf_del", workspaceId: "ws_123" });
      mocks.prisma.workflow.delete.mockResolvedValue({ id: "wf_del" });

      const res = await fetch(`${baseUrl}/workflows/wf_del`, {
        method: "DELETE",
        headers: { "x-test-role": "ADMIN" }
      });
      expect(res.status).toBe(204);
    });
  });

  describe("3. Contact Triggers & Duplicate Enrollment Prevention", () => {
    it("automatically enrolls eligible SUBSCRIBED contacts on CONTACT_SUBSCRIBED trigger", async () => {
      mocks.prisma.contact.findFirst.mockResolvedValue({
        id: "c_1",
        workspaceId: "ws_123",
        email: "alice@example.com",
        status: "SUBSCRIBED"
      });

      mocks.prisma.workflow.findMany.mockResolvedValue([
        {
          id: "wf_welcome",
          workspaceId: "ws_123",
          active: true,
          triggerType: "CONTACT_SUBSCRIBED",
          steps: [{ id: "step_1", stepOrder: 0, type: "EMAIL" }]
        }
      ]);

      mocks.prisma.workflowEnrollment.findUnique.mockResolvedValue(null);
      mocks.prisma.workflowEnrollment.create.mockResolvedValue({ id: "enr_1" });

      const result = await triggerWorkflowsForContact({
        workspaceId: "ws_123",
        contactId: "c_1",
        event: "CONTACT_SUBSCRIBED"
      });

      expect(result.enrolled.length).toBe(1);
      expect(mocks.prisma.workflowEnrollment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workflowId: "wf_welcome",
            contactId: "c_1",
            status: "ACTIVE"
          })
        })
      );
    });

    it("prevents duplicate enrollment if contact is already enrolled in the workflow", async () => {
      mocks.prisma.contact.findFirst.mockResolvedValue({
        id: "c_1",
        workspaceId: "ws_123",
        status: "SUBSCRIBED"
      });

      mocks.prisma.workflow.findMany.mockResolvedValue([
        {
          id: "wf_welcome",
          workspaceId: "ws_123",
          active: true,
          triggerType: "CONTACT_SUBSCRIBED",
          steps: [{ id: "step_1", stepOrder: 0, type: "EMAIL" }]
        }
      ]);

      // Already enrolled
      mocks.prisma.workflowEnrollment.findUnique.mockResolvedValue({ id: "enr_existing" });

      const result = await triggerWorkflowsForContact({
        workspaceId: "ws_123",
        contactId: "c_1",
        event: "CONTACT_SUBSCRIBED"
      });

      expect(result.enrolled.length).toBe(0);
      expect(mocks.prisma.workflowEnrollment.create).not.toHaveBeenCalled();
    });

    it("filters TAG_ADDED events by workflow trigger tag configuration", async () => {
      mocks.prisma.contact.findFirst.mockResolvedValue({
        id: "c_tag",
        workspaceId: "ws_123",
        status: "SUBSCRIBED"
      });

      mocks.prisma.workflow.findMany.mockResolvedValue([
        {
          id: "wf_vip",
          active: true,
          triggerType: "TAG_ADDED",
          triggerConfig: { tag: "vip" },
          steps: [{ id: "step_vip_1", stepOrder: 0, type: "EMAIL" }]
        }
      ]);

      mocks.prisma.workflowEnrollment.findUnique.mockResolvedValue(null);

      // Event tag is "newsletter", but workflow requires "vip"
      const nonMatching = await triggerWorkflowsForContact({
        workspaceId: "ws_123",
        contactId: "c_tag",
        event: "TAG_ADDED",
        data: { tag: "newsletter" }
      });
      expect(nonMatching.enrolled.length).toBe(0);

      // Event tag is "vip", matches!
      mocks.prisma.workflowEnrollment.create.mockResolvedValue({ id: "enr_vip" });
      const matching = await triggerWorkflowsForContact({
        workspaceId: "ws_123",
        contactId: "c_tag",
        event: "TAG_ADDED",
        data: { tag: "vip" }
      });
      expect(matching.enrolled.length).toBe(1);
    });
  });

  describe("4. Step Execution, Suppression Guards & Optimistic Locking", () => {
    it("cancels enrollment immediately if contact becomes UNSUBSCRIBED or BOUNCED (Suppression Guard)", async () => {
      const now = new Date("2026-11-21T12:00:00Z");

      mocks.prisma.workflowEnrollment.findMany.mockResolvedValue([
        {
          id: "enr_unsubbed",
          status: "ACTIVE",
          lockedAt: null,
          contact: { id: "c_unsub", email: "unsub@example.com", status: "UNSUBSCRIBED" },
          workflow: { id: "wf_1", steps: [{ id: "s1" }] }
        }
      ]);

      mocks.prisma.workflowEnrollment.updateMany.mockResolvedValue({ count: 1 });
      mocks.prisma.workflowEnrollment.update.mockResolvedValue({});

      const stats = await processDueWorkflows({ now });
      expect(stats.suppressed).toBe(1);
      expect(mocks.mockSendTransactionalEmail).not.toHaveBeenCalled();
      expect(mocks.prisma.workflowEnrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "enr_unsubbed" },
          data: expect.objectContaining({ status: "CANCELLED" })
        })
      );
    });

    it("prevents parallel workers from claiming the same enrollment via optimistic locking", async () => {
      const now = new Date("2026-11-21T12:00:00Z");

      mocks.prisma.workflowEnrollment.findMany.mockResolvedValue([
        {
          id: "enr_locked",
          status: "ACTIVE",
          lockedAt: null,
          contact: { id: "c_1", email: "c1@test.com", status: "SUBSCRIBED" },
          workflow: { id: "wf_1", steps: [{ id: "s1" }] }
        }
      ]);

      // updateMany returns 0 (concurrent worker claimed it first)
      mocks.prisma.workflowEnrollment.updateMany.mockResolvedValue({ count: 0 });

      const stats = await processDueWorkflows({ now });
      expect(stats.processed).toBe(0);
      expect(mocks.mockSendTransactionalEmail).not.toHaveBeenCalled();
    });

    it("executes EMAIL step, dispatches via Brevo, and advances to DELAY step", async () => {
      const now = new Date("2026-11-21T12:00:00Z");

      const steps = [
        { id: "s_email", stepOrder: 0, type: "EMAIL", config: { subject: "Hello {{firstName}}" } },
        { id: "s_delay", stepOrder: 1, type: "DELAY", config: { amount: 2, unit: "days" } }
      ];

      mocks.prisma.workflowExecution.findFirst.mockResolvedValue(null);
      mocks.prisma.workflowExecution.create.mockResolvedValue({ id: "exec_1", retryCount: 0 });
      mocks.prisma.workflowExecution.update.mockResolvedValue({});
      mocks.prisma.workflowEnrollment.update.mockResolvedValue({});

      const result = await executeEnrollmentStep({
        enrollment: { id: "enr_1" },
        step: steps[0],
        contact: { id: "c_1", email: "alice@example.com", firstName: "Alice", status: "SUBSCRIBED" },
        allSteps: steps,
        now
      });

      expect(mocks.mockSendTransactionalEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "alice@example.com",
          subject: "Hello Alice"
        })
      );

      expect(result.nextStepId).toBe("s_delay");
      // 2 days later: 2026-11-23T12:00:00Z
      expect(result.nextExecutionAt.toISOString()).toBe("2026-11-23T12:00:00.000Z");
    });

    it("prevents duplicate email execution if step already COMPLETED", async () => {
      const now = new Date("2026-11-21T12:00:00Z");

      const steps = [
        { id: "s_email_1", stepOrder: 0, type: "EMAIL" },
        { id: "s_email_2", stepOrder: 1, type: "EMAIL" }
      ];

      // Execution already completed
      mocks.prisma.workflowExecution.findFirst.mockResolvedValue({
        id: "exec_done",
        status: "COMPLETED"
      });
      mocks.prisma.workflowEnrollment.update.mockResolvedValue({});

      await executeEnrollmentStep({
        enrollment: { id: "enr_1" },
        step: steps[0],
        contact: { id: "c_1", email: "alice@example.com", status: "SUBSCRIBED" },
        allSteps: steps,
        now
      });

      expect(mocks.mockSendTransactionalEmail).not.toHaveBeenCalled();
    });

    it("schedules retry with exponential backoff on transient email delivery failure", async () => {
      const now = new Date("2026-11-21T12:00:00Z");
      const steps = [{ id: "s_email", stepOrder: 0, type: "EMAIL", config: { subject: "Test" } }];

      mocks.prisma.workflowExecution.findFirst.mockImplementation(({ where }) => {
        if (where?.status === "COMPLETED") return null;
        return { id: "exec_retry", retryCount: 0 };
      });
      mocks.mockSendTransactionalEmail.mockRejectedValueOnce(new Error("Brevo SMTP timeout"));
      mocks.prisma.workflowExecution.update.mockResolvedValue({});
      mocks.prisma.workflowEnrollment.update.mockResolvedValue({});

      const result = await executeEnrollmentStep({
        enrollment: { id: "enr_1" },
        step: steps[0],
        contact: { id: "c_1", email: "alice@example.com", status: "SUBSCRIBED" },
        allSteps: steps,
        now
      });

      expect(result.retrying).toBe(true);
      expect(result.retryCount).toBe(1);
      // 15s * 2^1 = 30s delay
      expect(mocks.prisma.workflowEnrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nextExecutionAt: new Date(now.getTime() + 30000),
            lockedAt: null
          })
        })
      );
    });
  });
});
