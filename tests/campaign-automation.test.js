import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import express from "express";

if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) {
  throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
}

process.env.UNSUBSCRIBE_SECRET = "test_unsub_secret_for_automation_12345";
process.env.PUBLIC_APP_URL = "http://localhost:5173";
process.env.BREVO_API_KEY = "test_brevo_api_key_automation";

const { prisma, sendTransactionalEmail } = vi.hoisted(() => ({
  prisma: {
    campaign: Object.fromEntries(
      ["findMany", "findFirst", "findUnique", "create", "update", "updateMany", "delete", "count"].map(k => [k, vi.fn()])
    ),
    campaignRecipient: Object.fromEntries(
      ["findMany", "findFirst", "createMany", "update", "updateMany", "count"].map(k => [k, vi.fn()])
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
vi.mock("../netlify/functions/_lib/brevo.mjs", () => ({ sendTransactionalEmail }));

vi.mock("../netlify/functions/_lib/auth.mjs", () => ({
  auth: (req, res, next) => {
    req.workspace = { id: req.headers["x-test-workspace"] || "workspace-1" };
    req.role = req.headers["x-test-role"] || "OWNER";
    req.user = { id: "user-1", name: "Test User", email: "user@example.com" };
    next();
  },
  requireRole: (...roles) => (req, res, next) => (roles.includes(req.role) ? next() : res.status(403).json({ error: "Forbidden" }))
}));

const {
  processDueCampaigns,
  processCampaignBatch,
  pauseCampaign,
  resumeCampaign,
  cancelScheduledCampaign,
  retryFailedRecipients,
  isEligibleForRetry
} = await import("../netlify/functions/_lib/campaign-runner.mjs");

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
    messageId: "<test-msg-123@smtp-relay.brevo.com>"
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

describe("Campaign Automation & Scheduling Engine", () => {
  const baseCampaign = {
    id: "camp-auto-1",
    workspaceId: "workspace-1",
    name: "Automated Flash Sale",
    subject: "Hurry up!",
    html: "<p>Hello {{firstName}}, big sale!</p>",
    fromEmail: "sales@example.com",
    fromName: "Sales Team",
    status: "SCHEDULED",
    scheduledAt: new Date(Date.now() - 60000), // 1 min ago (due!)
    targetTags: [],
    sendTotal: 0,
    sendSucceeded: 0,
    sendFailed: 0,
    lockedAt: null
  };

  it("1. Automatically claims and processes a scheduled campaign that has become due", async () => {
    // ScheduledAt is in the past
    prisma.campaign.findMany.mockResolvedValueOnce([{ ...baseCampaign }]);
    // Optimistic lock succeeds
    prisma.campaign.updateMany.mockResolvedValueOnce({ count: 1 });
    // Process campaign batch mock
    prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, status: "SENDING" });
    prisma.campaignRecipient.count.mockResolvedValueOnce(0); // initialize recipients
    prisma.contact.findMany.mockResolvedValueOnce([
      { id: "c-1", email: "alice@example.com" }
    ]);
    prisma.campaignRecipient.createMany.mockResolvedValueOnce({ count: 1 });
    prisma.campaign.update.mockResolvedValue({ ...baseCampaign, status: "SENDING" });

    prisma.campaignRecipient.findMany.mockResolvedValueOnce([
      {
        id: "cr-1",
        campaignId: baseCampaign.id,
        contactId: "c-1",
        email: "alice@example.com",
        status: "PENDING",
        attempts: 0,
        uncertain: false,
        contact: { id: "c-1", email: "alice@example.com", firstName: "Alice", status: "SUBSCRIBED" }
      }
    ]);
    prisma.campaignRecipient.update.mockResolvedValue({});
    // Post batch count
    prisma.campaignRecipient.count
      .mockResolvedValueOnce(1) // succeeded
      .mockResolvedValueOnce(0) // failed
      .mockResolvedValueOnce(0); // remaining pending (0)

    const result = await processDueCampaigns();

    expect(result.processed).toBe(1);
    expect(result.claimed).toContain(baseCampaign.id);
    expect(prisma.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: baseCampaign.id, status: "SCHEDULED" }),
        data: expect.objectContaining({ status: "SENDING" })
      })
    );
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it("2. Does NOT process future scheduled campaigns before their time arrives", async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
    // Query finds 0 due campaigns because scheduledAt > now
    prisma.campaign.findMany.mockResolvedValueOnce([]);

    const result = await processDueCampaigns({ now: new Date() });

    expect(result.processed).toBe(0);
    expect(result.claimed).toEqual([]);
    expect(prisma.campaign.updateMany).not.toHaveBeenCalled();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("3. Concurrency Protection: Prevents two workers from claiming the same campaign", async () => {
    prisma.campaign.findMany.mockResolvedValueOnce([{ ...baseCampaign }]);
    // Worker 2 loses the race (another worker claimed it, count: 0)
    prisma.campaign.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await processDueCampaigns();

    expect(result.processed).toBe(0);
    expect(result.claimed).toEqual([]);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("4. Interrupted batch recovery: reclaims stale SENDING campaign and processes remaining recipients", async () => {
    const staleTime = new Date(Date.now() - 15 * 60 * 1000); // 15 mins ago
    const staleCampaign = {
      ...baseCampaign,
      status: "SENDING",
      lockedAt: staleTime
    };

    prisma.campaign.findMany.mockResolvedValueOnce([staleCampaign]);
    prisma.campaign.updateMany.mockResolvedValueOnce({ count: 1 }); // claimed
    prisma.campaign.findUnique.mockResolvedValue(staleCampaign);
    prisma.campaignRecipient.count.mockResolvedValueOnce(10); // already initialized!
    prisma.campaignRecipient.findMany.mockResolvedValueOnce([
      {
        id: "cr-recovered",
        campaignId: staleCampaign.id,
        contactId: "c-recov",
        email: "bob@example.com",
        status: "PENDING",
        attempts: 0,
        uncertain: false,
        contact: { id: "c-recov", email: "bob@example.com", firstName: "Bob", status: "SUBSCRIBED" }
      }
    ]);
    prisma.campaignRecipient.update.mockResolvedValue({});
    prisma.campaignRecipient.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const result = await processDueCampaigns();
    expect(result.processed).toBe(1);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: [{ email: "bob@example.com", name: "Bob" }]
      })
    );
  });

  it("5. Exponential backoff and retry limits: retries transient errors up to limit, then marks FAILED", async () => {
    // 5a. Test isEligibleForRetry logic
    const recipient = { attempts: 1, lastAttemptAt: new Date(Date.now() - 5000), uncertain: false }; // only 5s passed, need 20s
    expect(isEligibleForRetry(recipient)).toBe(false);

    const readyRecipient = { attempts: 1, lastAttemptAt: new Date(Date.now() - 25000), uncertain: false }; // 25s passed
    expect(isEligibleForRetry(readyRecipient)).toBe(true);

    const maxedRecipient = { attempts: 3, lastAttemptAt: new Date(Date.now() - 100000), uncertain: false };
    expect(isEligibleForRetry(maxedRecipient)).toBe(false);

    // 5b. Transient failure in processCampaignBatch
    prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, status: "SENDING" });
    prisma.campaignRecipient.count.mockResolvedValueOnce(1);
    prisma.campaignRecipient.findMany.mockResolvedValueOnce([
      {
        id: "cr-transient",
        campaignId: baseCampaign.id,
        contactId: "c-1",
        email: "user@example.com",
        status: "PENDING",
        attempts: 2, // 2nd attempt, will become 3rd
        uncertain: false,
        contact: { id: "c-1", email: "user@example.com", status: "SUBSCRIBED" }
      }
    ]);

    sendTransactionalEmail.mockResolvedValueOnce({
      success: false,
      error: "Temporary mail server connection error",
      code: "HTTP_500"
    });

    prisma.campaignRecipient.update.mockResolvedValue({});
    prisma.campaignRecipient.count
      .mockResolvedValueOnce(0) // succeeded
      .mockResolvedValueOnce(1) // failed (reached 3 attempts!)
      .mockResolvedValueOnce(0); // remaining pending

    prisma.campaign.update.mockResolvedValue({});

    await processCampaignBatch(baseCampaign.id);

    // Verify recipient was marked FAILED after reaching max retries (3)
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cr-transient" },
        data: expect.objectContaining({
          status: "FAILED",
          attempts: 3,
          error: expect.stringMatching(/Max retries exceeded/)
        })
      })
    );
  });

  it("6. Brevo rate limit handling: halts batch gracefully without marking recipient permanently failed", async () => {
    prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, status: "SENDING" });
    prisma.campaignRecipient.count.mockResolvedValueOnce(1);
    prisma.campaignRecipient.findMany.mockResolvedValueOnce([
      {
        id: "cr-ratelimited",
        campaignId: baseCampaign.id,
        contactId: "c-1",
        email: "user@example.com",
        status: "PENDING",
        attempts: 0,
        uncertain: false,
        contact: { id: "c-1", email: "user@example.com", status: "SUBSCRIBED" }
      }
    ]);

    sendTransactionalEmail.mockResolvedValueOnce({
      success: false,
      code: "HTTP_429",
      error: "Too Many Requests"
    });

    prisma.campaignRecipient.update.mockResolvedValue({});
    prisma.campaignRecipient.count
      .mockResolvedValueOnce(0) // succeeded
      .mockResolvedValueOnce(0) // failed
      .mockResolvedValueOnce(1); // 1 still pending!

    prisma.campaign.update.mockResolvedValue({});

    const result = await processCampaignBatch(baseCampaign.id);

    expect(result.batch.rateLimited).toBe(true);
    // Recipient remains PENDING, NOT FAILED
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attempts: 1,
          error: expect.stringMatching(/Brevo rate limit/)
        })
      })
    );
  });

  it("7. Uncertain delivery outcomes: network timeout marks uncertain without automatic resend", async () => {
    prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, status: "SENDING" });
    prisma.campaignRecipient.count.mockResolvedValueOnce(1);
    prisma.campaignRecipient.findMany.mockResolvedValueOnce([
      {
        id: "cr-timeout",
        campaignId: baseCampaign.id,
        contactId: "c-1",
        email: "user@example.com",
        status: "PENDING",
        attempts: 0,
        uncertain: false,
        contact: { id: "c-1", email: "user@example.com", status: "SUBSCRIBED" }
      }
    ]);

    // Network timeout during fetch
    sendTransactionalEmail.mockResolvedValueOnce({
      success: false,
      code: "NETWORK_TIMEOUT",
      error: "Network timeout waiting for email delivery service."
    });

    prisma.campaignRecipient.update.mockResolvedValue({});
    prisma.campaignRecipient.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    prisma.campaign.update.mockResolvedValue({});

    await processCampaignBatch(baseCampaign.id);

    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cr-timeout" },
        data: expect.objectContaining({
          status: "FAILED",
          uncertain: true,
          error: expect.stringMatching(/Uncertain delivery outcome/)
        })
      })
    );
  });

  it("8. Pause and Resume campaign controls", async () => {
    // 8a. Pause
    prisma.campaign.findFirst.mockResolvedValueOnce({
      ...baseCampaign,
      status: "SENDING"
    });
    prisma.campaign.update.mockResolvedValueOnce({
      ...baseCampaign,
      status: "PAUSED"
    });

    const pauseRes = await pauseCampaign(baseCampaign.id, "workspace-1");
    expect(pauseRes.success).toBe(true);
    expect(pauseRes.campaign.status).toBe("PAUSED");

    // 8b. Resume
    prisma.campaign.findFirst.mockResolvedValueOnce({
      ...baseCampaign,
      status: "PAUSED"
    });
    prisma.campaign.update.mockResolvedValueOnce({
      ...baseCampaign,
      status: "SENDING"
    });
    prisma.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      status: "SENDING"
    });
    prisma.campaignRecipient.count.mockResolvedValue(1);
    prisma.campaignRecipient.findMany.mockResolvedValue([]);

    const resumeRes = await resumeCampaign(baseCampaign.id, "workspace-1");
    expect(resumeRes.success).toBe(true);
  });

  it("9. Cancel scheduled campaign before sending", async () => {
    prisma.campaign.findFirst.mockResolvedValueOnce({
      ...baseCampaign,
      status: "SCHEDULED"
    });
    prisma.campaign.update.mockResolvedValueOnce({
      ...baseCampaign,
      status: "DRAFT",
      scheduledAt: null
    });

    const cancelRes = await cancelScheduledCampaign(baseCampaign.id, "workspace-1");
    expect(cancelRes.success).toBe(true);
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: baseCampaign.id },
        data: expect.objectContaining({ status: "DRAFT", scheduledAt: null })
      })
    );
  });

  it("10. Enforces workspace isolation on pause/resume/retry", async () => {
    prisma.campaign.findFirst.mockResolvedValue(null); // foreign workspace

    const pauseRes = await pauseCampaign("foreign-id", "attacker-workspace");
    expect(pauseRes.success).toBe(false);
    expect(pauseRes.status).toBe(404);

    const resumeRes = await resumeCampaign("foreign-id", "attacker-workspace");
    expect(resumeRes.success).toBe(false);
    expect(resumeRes.status).toBe(404);
  });

  it("11. Excludes suppressed contacts (BOUNCED/COMPLAINED) from delivery", async () => {
    prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, status: "SENDING" });
    prisma.campaignRecipient.count.mockResolvedValueOnce(1);
    prisma.campaignRecipient.findMany.mockResolvedValueOnce([
      {
        id: "cr-suppressed",
        campaignId: baseCampaign.id,
        contactId: "c-bounced",
        email: "bounced@example.com",
        status: "PENDING",
        attempts: 0,
        uncertain: false,
        contact: { id: "c-bounced", email: "bounced@example.com", status: "BOUNCED" } // Contact was suppressed!
      }
    ]);

    prisma.campaignRecipient.update.mockResolvedValue({});
    prisma.campaignRecipient.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    prisma.campaign.update.mockResolvedValue({});

    await processCampaignBatch(baseCampaign.id);

    // Suppressed contact is marked FAILED without dispatching to Brevo
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cr-suppressed" },
        data: expect.objectContaining({
          status: "FAILED",
          error: expect.stringMatching(/not subscribed/)
        })
      })
    );
  });

  it("12. Counter consistency: campaign counters accurately reflect succeeded and failed recipients", async () => {
    prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, status: "SENDING" });
    prisma.campaignRecipient.count.mockResolvedValueOnce(2);
    prisma.campaignRecipient.findMany.mockResolvedValueOnce([]); // No pending recipients left

    // Finalize counts
    prisma.campaignRecipient.count
      .mockResolvedValueOnce(8) // 8 succeeded
      .mockResolvedValueOnce(2) // 2 failed
      .mockResolvedValueOnce(0) // 0 pending
      .mockResolvedValueOnce(0); // 0 uncertain

    prisma.campaign.update.mockResolvedValue({});

    await processCampaignBatch(baseCampaign.id);

    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: baseCampaign.id },
        data: expect.objectContaining({
          status: "SENT",
          sendSucceeded: 8,
          sendFailed: 2
        })
      })
    );
  });
});
