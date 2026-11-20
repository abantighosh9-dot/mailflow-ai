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

const { default: routes } = await import("../netlify/functions/routes/campaigns.mjs");
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

describe("campaign scheduling API", () => {
  const validDraftCampaign = {
    id: "camp-valid",
    workspaceId: "workspace-1",
    name: "Black Friday Blast",
    subject: "Early Deals Inside!",
    html: "<h1>Big Sale</h1><p>Check it out</p>",
    fromEmail: "deals@example.com",
    fromName: "Sales Team",
    status: "DRAFT",
    targetTags: ["deals"]
  };

  it("schedules a valid draft campaign for a future time", async () => {
    prisma.campaign.findFirst.mockResolvedValue({ ...validDraftCampaign });
    prisma.contact.count.mockResolvedValue(150); // 150 eligible subscribers

    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    prisma.campaign.update.mockImplementation(async ({ data }) => ({
      ...validDraftCampaign,
      status: data.status,
      scheduledAt: data.scheduledAt,
      sendTotal: data.sendTotal
    }));

    const { response, body } = await call("/campaigns/camp-valid/schedule", {
      method: "POST",
      body: JSON.stringify({ scheduledAt: futureDate })
    });

    expect(response.status).toBe(200);
    expect(body.campaign.status).toBe("SCHEDULED");
    expect(body.eligibleRecipientsCount).toBe(150);
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "camp-valid" },
        data: expect.objectContaining({
          status: "SCHEDULED",
          scheduledAt: expect.any(Date),
          sendTotal: 150
        })
      })
    );
  });

  it("rejects scheduling with past date or time", async () => {
    prisma.campaign.findFirst.mockResolvedValue({ ...validDraftCampaign });

    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
    const { response, body } = await call("/campaigns/camp-valid/schedule", {
      method: "POST",
      body: JSON.stringify({ scheduledAt: pastDate })
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain("future");
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it("rejects scheduling when campaign email content is missing or empty", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      ...validDraftCampaign,
      html: "" // empty body
    });

    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    const { response, body } = await call("/campaigns/camp-valid/schedule", {
      method: "POST",
      body: JSON.stringify({ scheduledAt: futureDate })
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain("email body cannot be empty");
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it("rejects scheduling when sender email address is missing or invalid", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      ...validDraftCampaign,
      fromEmail: null
    });

    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    const { response, body } = await call("/campaigns/camp-valid/schedule", {
      method: "POST",
      body: JSON.stringify({ scheduledAt: futureDate })
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain("sender email address is required");
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it("rejects scheduling when there are zero eligible subscribers in audience", async () => {
    prisma.campaign.findFirst.mockResolvedValue({ ...validDraftCampaign });
    prisma.contact.count.mockResolvedValue(0); // 0 subscribers

    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    const { response, body } = await call("/campaigns/camp-valid/schedule", {
      method: "POST",
      body: JSON.stringify({ scheduledAt: futureDate })
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain("No eligible subscribed contacts");
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it("enforces workspace isolation on schedule endpoint", async () => {
    prisma.campaign.findFirst.mockResolvedValue(null); // Not in workspace

    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    const { response } = await call("/campaigns/foreign-camp/schedule", {
      method: "POST",
      body: JSON.stringify({ scheduledAt: futureDate })
    });

    expect(response.status).toBe(404);
    expect(prisma.campaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "foreign-camp", workspaceId: "workspace-1" }
      })
    );
  });

  it("prevents scheduling duplicate or already-scheduled campaigns", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      ...validDraftCampaign,
      status: "SCHEDULED" // Already scheduled
    });

    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    const { response, body } = await call("/campaigns/camp-valid/schedule", {
      method: "POST",
      body: JSON.stringify({ scheduledAt: futureDate })
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain("Only draft campaigns can be scheduled");
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it.each(["VIEWER", "ANALYST"])("blocks %s role from scheduling or cancelling", async role => {
    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    const schedRes = await call("/campaigns/camp-1/schedule", {
      method: "POST",
      headers: { "x-test-role": role },
      body: JSON.stringify({ scheduledAt: futureDate })
    });
    expect(schedRes.response.status).toBe(403);

    const cancelRes = await call("/campaigns/camp-1/cancel-schedule", {
      method: "POST",
      headers: { "x-test-role": role }
    });
    expect(cancelRes.response.status).toBe(403);
  });

  it("cancels a scheduled campaign, returning it to DRAFT and clearing scheduledAt", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      ...validDraftCampaign,
      status: "SCHEDULED",
      scheduledAt: new Date(Date.now() + 100000)
    });
    prisma.campaign.update.mockResolvedValue({
      ...validDraftCampaign,
      status: "DRAFT",
      scheduledAt: null
    });

    const { response, body } = await call("/campaigns/camp-valid/cancel-schedule", {
      method: "POST"
    });

    expect(response.status).toBe(200);
    expect(body.campaign.status).toBe("DRAFT");
    expect(body.campaign.scheduledAt).toBeNull();
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "camp-valid" },
        data: expect.objectContaining({
          status: "DRAFT",
          scheduledAt: null
        })
      })
    );
  });

  it("rejects cancel-schedule on non-scheduled campaigns", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      ...validDraftCampaign,
      status: "DRAFT" // Not scheduled
    });

    const { response, body } = await call("/campaigns/camp-valid/cancel-schedule", {
      method: "POST"
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain("Only scheduled campaigns can have their schedule cancelled");
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });
});
