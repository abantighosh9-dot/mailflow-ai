import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import express from "express";

if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) {
  throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
}

const { prisma } = vi.hoisted(() => ({
  prisma: {
    campaign: Object.fromEntries(
      ["findMany", "findFirst", "findUnique", "create", "update", "delete", "count"].map(k => [k, vi.fn()])
    ),
    emailTemplate: Object.fromEntries(
      ["findMany", "findFirst", "findUnique"].map(k => [k, vi.fn()])
    ),
    contact: Object.fromEntries(
      ["findMany", "findFirst", "count"].map(k => [k, vi.fn()])
    )
  }
}));

vi.mock("../netlify/functions/_lib/db.mjs", () => ({ prisma, default: prisma }));

vi.mock("../netlify/functions/_lib/auth.mjs", () => ({
  auth: (req, res, next) => {
    req.workspace = { id: req.headers["x-test-workspace"] || "workspace-1" };
    req.role = req.headers["x-test-role"] || "OWNER";
    req.user = { id: "user-1", name: "Test User", email: "user@example.com" };
    next();
  },
  requireRole: (...roles) => (req, res, next) => (roles.includes(req.role) ? next() : res.status(403).json({ error: "Forbidden" }))
}));

const { default: routes, buildEligibleContactsWhere } = await import("../netlify/functions/routes/campaigns.mjs");
const app = express();
app.use(express.json());
app.use(routes);

let server, base;

beforeAll(async () => {
  server = createServer(app);
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => new Promise(ok => server.close(ok)));

beforeEach(() => vi.clearAllMocks());

async function call(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const clone = response.clone();
  return { response, body: await response.json().catch(() => null), text: await clone.text() };
}

describe("campaigns API", () => {
  it("creates a draft campaign with valid inputs", async () => {
    const mockCreated = {
      id: "camp-1",
      workspaceId: "workspace-1",
      name: "Spring Sale",
      subject: "Huge discounts!",
      status: "DRAFT",
      html: "<p>Hello</p>",
      targetTags: ["spring"]
    };
    prisma.campaign.create.mockResolvedValue(mockCreated);

    const { response, body } = await call("/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: "Spring Sale",
        subject: "Huge discounts!",
        html: "<p>Hello</p>",
        targetTags: ["spring"]
      })
    });

    expect(response.status).toBe(201);
    expect(body.campaign.name).toBe("Spring Sale");
    expect(prisma.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: "workspace-1",
          name: "Spring Sale",
          subject: "Huge discounts!",
          status: "DRAFT"
        })
      })
    );
  });

  it("returns 400 for invalid campaign input (missing subject or name)", async () => {
    const { response, body } = await call("/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "" })
    });

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
    expect(prisma.campaign.create).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid sender email address", async () => {
    const { response, body } = await call("/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: "Test",
        subject: "Sub",
        fromEmail: "invalid-email-not-valid"
      })
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid sender email");
    expect(prisma.campaign.create).not.toHaveBeenCalled();
  });

  it("rejects campaign creation if templateId does not belong to the workspace", async () => {
    prisma.emailTemplate.findFirst.mockResolvedValue(null);

    const { response, body } = await call("/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: "Promo",
        subject: "Save big",
        templateId: "cross-workspace-template"
      })
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain("Template not found or does not belong to this workspace");
    expect(prisma.emailTemplate.findFirst).toHaveBeenCalledWith({
      where: { id: "cross-workspace-template", workspaceId: "workspace-1" }
    });
  });

  it("lists workspace campaigns with pagination, search, and status filter", async () => {
    prisma.campaign.findMany.mockResolvedValue([
      { id: "c1", name: "Newsletter #1", subject: "Update", status: "DRAFT" }
    ]);
    prisma.campaign.count.mockResolvedValue(1);

    const { response, body } = await call("/campaigns?page=1&limit=10&q=Newsletter&status=DRAFT");

    expect(response.status).toBe(200);
    expect(body.campaigns).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.pages).toBe(1);
    expect(prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "workspace-1",
          AND: expect.arrayContaining([
            {
              OR: [
                { name: { contains: "Newsletter", mode: "insensitive" } },
                { subject: { contains: "Newsletter", mode: "insensitive" } }
              ]
            },
            { status: "DRAFT" }
          ])
        }),
        skip: 0,
        take: 10
      })
    );
  });

  it("enforces workspace isolation on GET /campaigns/:id", async () => {
    prisma.campaign.findFirst.mockResolvedValue(null);

    const { response } = await call("/campaigns/foreign-camp-id");

    expect(response.status).toBe(404);
    expect(prisma.campaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "foreign-camp-id", workspaceId: "workspace-1" }
      })
    );
  });

  it("updates an editable draft campaign", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      id: "camp-draft",
      workspaceId: "workspace-1",
      status: "DRAFT"
    });
    prisma.campaign.update.mockResolvedValue({
      id: "camp-draft",
      name: "Updated Name",
      status: "DRAFT"
    });

    const { response, body } = await call("/campaigns/camp-draft", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated Name" })
    });

    expect(response.status).toBe(200);
    expect(body.campaign.name).toBe("Updated Name");
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "camp-draft" },
        data: expect.objectContaining({ name: "Updated Name" })
      })
    );
  });

  it("rejects editing a non-draft campaign (e.g. SENT, SENDING)", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      id: "camp-sent",
      workspaceId: "workspace-1",
      status: "SENT"
    });

    const { response, body } = await call("/campaigns/camp-sent", {
      method: "PATCH",
      body: JSON.stringify({ name: "Cannot Rename Sent Campaign" })
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain("Only draft campaigns can be edited");
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it("deletes a draft campaign", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      id: "camp-del",
      workspaceId: "workspace-1",
      status: "DRAFT"
    });
    prisma.campaign.delete.mockResolvedValue({ id: "camp-del" });

    const { response, body } = await call("/campaigns/camp-del", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(prisma.campaign.delete).toHaveBeenCalledWith({ where: { id: "camp-del" } });
  });

  it("rejects deleting a non-draft campaign", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      id: "camp-sending",
      workspaceId: "workspace-1",
      status: "SENDING"
    });

    const { response, body } = await call("/campaigns/camp-sending", { method: "DELETE" });

    expect(response.status).toBe(400);
    expect(body.error).toContain("Only draft campaigns can be deleted");
    expect(prisma.campaign.delete).not.toHaveBeenCalled();
  });

  it.each(["VIEWER", "ANALYST"])("blocks %s roles from performing campaign writes", async role => {
    const postRes = await call("/campaigns", {
      method: "POST",
      headers: { "x-test-role": role },
      body: JSON.stringify({ name: "Attempt", subject: "Blocked" })
    });
    expect(postRes.response.status).toBe(403);

    const patchRes = await call("/campaigns/c1", {
      method: "PATCH",
      headers: { "x-test-role": role },
      body: JSON.stringify({ name: "Attempt" })
    });
    expect(patchRes.response.status).toBe(403);

    const deleteRes = await call("/campaigns/c1", {
      method: "DELETE",
      headers: { "x-test-role": role }
    });
    expect(deleteRes.response.status).toBe(403);
  });

  it("builds recipient eligibility filter strictly including SUBSCRIBED and excluding others", () => {
    const whereNoTags = buildEligibleContactsWhere("ws-1");
    expect(whereNoTags).toEqual({
      workspaceId: "ws-1",
      status: "SUBSCRIBED"
    });

    const whereWithTags = buildEligibleContactsWhere("ws-1", { targetTags: ["Vip", "PRO"] });
    expect(whereWithTags).toEqual({
      workspaceId: "ws-1",
      status: "SUBSCRIBED",
      tags: { hasSome: ["vip", "pro"] }
    });
  });
});
