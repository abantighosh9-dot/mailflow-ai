import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import express from "express";

if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) {
  throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
}

// Ensure unsubscribe and brevo env vars are present during test run
process.env.UNSUBSCRIBE_SECRET = "test_unsubscribe_secret_for_vitest_runs_12345";
process.env.JWT_SECRET = "test_jwt_secret_for_vitest_runs_12345";
process.env.PUBLIC_APP_URL = "http://localhost:5173";
process.env.BREVO_API_KEY = "xkeysib-mock-api-key-test";

const { prisma, sendTransactionalEmail } = vi.hoisted(() => ({
  prisma: {
    campaign: Object.fromEntries(
      ["findMany", "findFirst", "findUnique", "create", "update", "delete", "count"].map(k => [k, vi.fn()])
    ),
    campaignRecipient: Object.fromEntries(
      ["findMany", "findFirst", "createMany", "update", "count"].map(k => [k, vi.fn()])
    ),
    contact: Object.fromEntries(
      ["findMany", "findFirst", "count"].map(k => [k, vi.fn()])
    ),
    emailTemplate: Object.fromEntries(
      ["findMany", "findFirst", "findUnique"].map(k => [k, vi.fn()])
    )
  },
  sendTransactionalEmail: vi.fn()
}));

vi.mock("../netlify/functions/_lib/db.mjs", () => ({ prisma, default: prisma }));

vi.mock("../netlify/functions/_lib/brevo.mjs", () => ({
  sendTransactionalEmail
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  sendTransactionalEmail.mockResolvedValue({
    success: true,
    messageId: "<test-msg-12345@smtp-relay.brevo.com>"
  });
});

async function call(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const clone = response.clone();
  return { response, body: await response.json().catch(() => null), text: await clone.text() };
}

describe("POST /campaigns/:id/send - Brevo Email Delivery Integration", () => {
  const validCampaign = {
    id: "camp-123",
    workspaceId: "workspace-1",
    name: "Spring Product Launch",
    subject: "Discover our new platform!",
    html: "<h1>Hello {{firstName}}!</h1><p>We are thrilled to launch.</p>",
    fromEmail: "newsletter@example.com",
    fromName: "Marketing Team",
    status: "DRAFT",
    targetTags: ["newsletter"],
    sendTotal: 0,
    sendSucceeded: 0,
    sendFailed: 0
  };

  it("successfully sends emails via Brevo and updates recipient states and counters", async () => {
    prisma.campaign.findFirst.mockResolvedValue({ ...validCampaign });
    prisma.campaignRecipient.count
      .mockResolvedValueOnce(0) // existing recipient count: 0 -> initialize
      .mockResolvedValueOnce(1) // count SENT
      .mockResolvedValueOnce(0) // count FAILED
      .mockResolvedValueOnce(0); // count remaining PENDING

    prisma.contact.findMany.mockResolvedValue([
      { id: "c-1", email: "alice@example.com" }
    ]);
    prisma.campaignRecipient.createMany.mockResolvedValue({ count: 1 });
    prisma.campaign.update.mockImplementation(async ({ data }) => ({
      ...validCampaign,
      ...data
    }));

    prisma.campaignRecipient.findMany.mockResolvedValue([
      {
        id: "cr-1",
        campaignId: "camp-123",
        contactId: "c-1",
        email: "alice@example.com",
        status: "PENDING",
        contact: {
          id: "c-1",
          email: "alice@example.com",
          firstName: "Alice",
          lastName: "Smith",
          status: "SUBSCRIBED"
        }
      }
    ]);
    prisma.campaignRecipient.update.mockResolvedValue({});

    sendTransactionalEmail.mockResolvedValue({
      success: true,
      messageId: "<brevo-msg-abc-123@smtp-relay.brevo.com>"
    });

    const { response, body } = await call("/campaigns/camp-123/send", { method: "POST" });

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.isComplete).toBe(true);
    expect(body.batch.succeeded).toBe(1);
    expect(body.batch.failed).toBe(0);

    // Verify Brevo was called with proper payload including unsubscribe headers
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const sendArgs = sendTransactionalEmail.mock.calls[0][0];
    expect(sendArgs.sender).toEqual({ name: "Marketing Team", email: "newsletter@example.com" });
    expect(sendArgs.to).toEqual([{ email: "alice@example.com", name: "Alice Smith" }]);
    expect(sendArgs.subject).toBe("Discover our new platform!");
    expect(sendArgs.htmlContent).toContain("Hello Alice!");
    expect(sendArgs.htmlContent).toContain("api/unsubscribe?token=");
    expect(sendArgs.headers["List-Unsubscribe"]).toContain("api/unsubscribe?token=");

    // Verify recipient record updated to SENT with messageId
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cr-1" },
        data: expect.objectContaining({
          status: "SENT",
          messageId: "<brevo-msg-abc-123@smtp-relay.brevo.com>"
        })
      })
    );
  });

  it("handles provider errors safely and updates recipient status to FAILED", async () => {
    prisma.campaign.findFirst.mockResolvedValue({ ...validCampaign });
    prisma.campaignRecipient.count
      .mockResolvedValueOnce(1) // already has recipients
      .mockResolvedValueOnce(0) // count SENT
      .mockResolvedValueOnce(1) // count FAILED
      .mockResolvedValueOnce(0); // count remaining PENDING

    prisma.campaignRecipient.findMany.mockResolvedValue([
      {
        id: "cr-1",
        campaignId: "camp-123",
        contactId: "c-1",
        email: "bounce@example.com",
        status: "PENDING",
        contact: {
          id: "c-1",
          email: "bounce@example.com",
          firstName: "Bad",
          status: "SUBSCRIBED"
        }
      }
    ]);
    prisma.campaignRecipient.update.mockResolvedValue({});
    prisma.campaign.update.mockImplementation(async ({ data }) => ({
      ...validCampaign,
      ...data
    }));

    sendTransactionalEmail.mockResolvedValue({
      success: false,
      error: "Invalid recipient mailbox",
      code: "invalid_parameter"
    });

    const { response, body } = await call("/campaigns/camp-123/send", { method: "POST" });

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.batch.succeeded).toBe(0);
    expect(body.batch.failed).toBe(1);

    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cr-1" },
        data: expect.objectContaining({
          status: "FAILED",
          error: "Invalid recipient mailbox"
        })
      })
    );
  });

  it("rejects campaign send when sender details or content are invalid", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      ...validCampaign,
      fromEmail: "invalid-email"
    });

    const { response, body } = await call("/campaigns/camp-123/send", { method: "POST" });
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/valid sender email/i);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("rejects campaign send when subject line is missing", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      ...validCampaign,
      subject: "   "
    });

    const { response, body } = await call("/campaigns/camp-123/send", { method: "POST" });
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/subject line is required/i);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("excludes ineligible contacts and rejects sending if no eligible contacts exist", async () => {
    prisma.campaign.findFirst.mockResolvedValue({ ...validCampaign });
    prisma.campaignRecipient.count.mockResolvedValueOnce(0); // 0 existing
    prisma.contact.findMany.mockResolvedValue([]); // 0 eligible contacts

    const { response, body } = await call("/campaigns/camp-123/send", { method: "POST" });
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/no eligible subscribed contacts/i);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("prevents duplicate send if campaign is already in SENT status", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      ...validCampaign,
      status: "SENT"
    });

    const { response, body } = await call("/campaigns/camp-123/send", { method: "POST" });
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/already been sent/i);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("prevents sending if campaign is CANCELLED", async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      ...validCampaign,
      status: "CANCELLED"
    });

    const { response, body } = await call("/campaigns/camp-123/send", { method: "POST" });
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/cannot send a cancelled campaign/i);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("enforces workspace isolation by returning 404 for campaign of another workspace", async () => {
    prisma.campaign.findFirst.mockResolvedValue(null);

    const { response, body } = await call("/campaigns/camp-foreign/send", {
      method: "POST",
      headers: { "x-test-workspace": "workspace-attacker" }
    });

    expect(response.status).toBe(404);
    expect(body.error).toMatch(/campaign not found/i);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("restricts campaign dispatch to OWNER, ADMIN, and EDITOR roles", async () => {
    const { response, body } = await call("/campaigns/camp-123/send", {
      method: "POST",
      headers: { "x-test-role": "VIEWER" }
    });

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("handles partial delivery failures accurately in a batch", async () => {
    prisma.campaign.findFirst.mockResolvedValue({ ...validCampaign, status: "SENDING" });
    prisma.campaignRecipient.count
      .mockResolvedValueOnce(2) // already initialized
      .mockResolvedValueOnce(1) // count SENT
      .mockResolvedValueOnce(1) // count FAILED
      .mockResolvedValueOnce(0); // count PENDING (0 remaining)

    prisma.campaignRecipient.findMany.mockResolvedValue([
      {
        id: "cr-1",
        contactId: "c-1",
        email: "good@example.com",
        status: "PENDING",
        contact: { id: "c-1", email: "good@example.com", firstName: "Good", status: "SUBSCRIBED" }
      },
      {
        id: "cr-2",
        contactId: "c-2",
        email: "bad@example.com",
        status: "PENDING",
        contact: { id: "c-2", email: "bad@example.com", firstName: "Bad", status: "SUBSCRIBED" }
      }
    ]);
    prisma.campaignRecipient.update.mockResolvedValue({});
    prisma.campaign.update.mockImplementation(async ({ data }) => ({
      ...validCampaign,
      ...data
    }));

    sendTransactionalEmail
      .mockResolvedValueOnce({ success: true, messageId: "<msg-1>" })
      .mockResolvedValueOnce({ success: false, error: "Mailbox does not exist" });

    const { response, body } = await call("/campaigns/camp-123/send", { method: "POST" });

    expect(response.status).toBe(200);
    expect(body.batch.succeeded).toBe(1);
    expect(body.batch.failed).toBe(1);
    expect(body.batch.remaining).toBe(0);
    expect(body.isComplete).toBe(true);

    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SENT",
          sendSucceeded: 1,
          sendFailed: 1
        })
      })
    );
  });

  it("ensures idempotency by skipping already-processed recipients and only taking PENDING", async () => {
    prisma.campaign.findFirst.mockResolvedValue({ ...validCampaign, status: "SENDING" });
    prisma.campaignRecipient.count
      .mockResolvedValueOnce(5) // already has 5 recipients initialized
      .mockResolvedValueOnce(4) // 4 SENT
      .mockResolvedValueOnce(1) // 1 FAILED
      .mockResolvedValueOnce(0); // 0 remaining PENDING

    // findMany only queries status: "PENDING"
    prisma.campaignRecipient.findMany.mockResolvedValue([
      {
        id: "cr-last",
        contactId: "c-5",
        email: "last@example.com",
        status: "PENDING",
        contact: { id: "c-5", email: "last@example.com", firstName: "Last", status: "SUBSCRIBED" }
      }
    ]);
    prisma.campaignRecipient.update.mockResolvedValue({});
    prisma.campaign.update.mockImplementation(async ({ data }) => ({
      ...validCampaign,
      ...data
    }));

    sendTransactionalEmail.mockResolvedValue({ success: true, messageId: "<msg-last>" });

    const { response, body } = await call("/campaigns/camp-123/send", { method: "POST" });

    expect(response.status).toBe(200);
    expect(body.batch.processed).toBe(1);
    expect(body.batch.succeeded).toBe(1);
    expect(prisma.campaignRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: "camp-123", status: "PENDING" }
      })
    );
  });
});
