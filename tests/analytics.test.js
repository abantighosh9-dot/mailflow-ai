import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import express from "express";

if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) {
  throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
}

const { prisma } = vi.hoisted(() => ({
  prisma: {
    campaign: Object.fromEntries(
      ["findMany", "findFirst", "findUnique", "count", "groupBy", "aggregate"].map(k => [k, vi.fn()])
    ),
    campaignRecipient: Object.fromEntries(
      ["findMany", "findFirst", "count", "groupBy"].map(k => [k, vi.fn()])
    )
  }
}));

vi.mock("../netlify/functions/_lib/db.mjs", () => ({ prisma, default: prisma }));

vi.mock("../netlify/functions/_lib/auth.mjs", () => ({
  auth: (req, res, next) => {
    if (req.headers["x-test-unauthenticated"]) {
      return res.status(401).json({ error: "Please sign in." });
    }
    req.workspace = { id: req.headers["x-test-workspace"] || "workspace-123" };
    req.role = req.headers["x-test-role"] || "OWNER";
    req.user = { id: "user-1", name: "Analyst User", email: "analyst@example.com" };
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (!req.role || !roles.includes(req.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  }
}));

const { default: routes, calculateRates, parseDateFilter } = await import("../netlify/functions/routes/analytics.mjs");
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
});

async function call(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const clone = response.clone();
  return { response, body: await response.json().catch(() => null), text: await clone.text() };
}

describe("Campaign Analytics Dashboard API", () => {
  describe("Unit: calculateRates and parseDateFilter helpers", () => {
    it("safely calculates rates and handles zero denominators gracefully without NaN or Infinity", () => {
      // All zeroes
      const zeroRates = calculateRates({
        sendSucceeded: 0,
        deliveredCount: 0,
        openedCount: 0,
        clickedCount: 0,
        bouncedCount: 0
      });

      expect(zeroRates.deliveryRate).toBe(0);
      expect(zeroRates.openRate).toBe(0);
      expect(zeroRates.clickRate).toBe(0);
      expect(zeroRates.bounceRate).toBe(0);
      expect(Number.isNaN(zeroRates.openRate)).toBe(false);

      // Normal numbers
      const normalRates = calculateRates({
        sendSucceeded: 1000,
        deliveredCount: 950,
        openedCount: 380,
        clickedCount: 95,
        bouncedCount: 50
      });

      // Delivery = 950 / 1000 = 95%
      expect(normalRates.deliveryRate).toBe(95);
      // Open = 380 / 950 = 40%
      expect(normalRates.openRate).toBe(40);
      // Click = 95 / 950 = 10%
      expect(normalRates.clickRate).toBe(10);
      // Bounce = 50 / 1000 = 5%
      expect(normalRates.bounceRate).toBe(5);
    });

    it("parses valid date ranges correctly (7d, 30d, 90d, custom)", () => {
      const fixedNow = new Date("2026-11-17T12:00:00Z");

      const r7 = parseDateFilter({ range: "7d" }, fixedNow);
      expect(r7.range).toBe("7d");
      expect(r7.endDate.getTime()).toBe(fixedNow.getTime());
      expect(fixedNow.getTime() - r7.startDate.getTime()).toBe(7 * 24 * 60 * 60 * 1000);

      const rCustom = parseDateFilter({
        range: "custom",
        startDate: "2026-01-01",
        endDate: "2026-01-31"
      }, fixedNow);
      expect(rCustom.range).toBe("custom");
      expect(rCustom.startDate.toISOString()).toContain("2026-01-01");
      expect(rCustom.endDate.toISOString()).toContain("2026-01-31");
    });

    it("rejects invalid custom date ranges", () => {
      expect(() => parseDateFilter({ range: "custom" })).toThrow(/requires both start and end/i);
      expect(() => parseDateFilter({ range: "custom", from: "not-a-date", to: "2026-01-01" })).toThrow(/invalid date/i);
      expect(() => parseDateFilter({ range: "custom", from: "2026-05-01", to: "2026-01-01" })).toThrow(/cannot be later/i);
    });
  });

  describe("GET /analytics/overview", () => {
    it("returns overall metrics and rates scoped to workspace", async () => {
      prisma.campaign.count.mockResolvedValueOnce(15); // total campaigns
      prisma.campaign.groupBy.mockResolvedValueOnce([
        { status: "SENT", _count: { id: 10 } },
        { status: "DRAFT", _count: { id: 3 } },
        { status: "FAILED", _count: { id: 2 } }
      ]);
      prisma.campaign.aggregate.mockResolvedValueOnce({
        _count: { id: 12 },
        _sum: {
          sendTotal: 5000,
          sendSucceeded: 4800,
          sendFailed: 200,
          deliveredCount: 4600,
          bouncedCount: 200,
          openedCount: 1840,
          clickedCount: 460,
          complainedCount: 5
        }
      });

      const { response, body } = await call("/analytics/overview?range=30d", {
        headers: { "x-test-workspace": "workspace-123" }
      });

      expect(response.status).toBe(200);
      expect(body.summary.totalCampaigns).toBe(15);
      expect(body.summary.sentCampaigns).toBe(12);
      expect(body.summary.targetedRecipients).toBe(5000);
      expect(body.summary.submitted).toBe(4800);
      expect(body.summary.delivered).toBe(4600);
      expect(body.summary.failed).toBe(200);
      expect(body.summary.bounced).toBe(200);
      expect(body.summary.opened).toBe(1840);
      expect(body.summary.clicked).toBe(460);
      expect(body.summary.complained).toBe(5);

      // Verify rates:
      // Delivery = 4600 / 4800 = 95.83%
      expect(body.summary.deliveryRate).toBe(95.83);
      // Open = 1840 / 4600 = 40.0%
      expect(body.summary.openRate).toBe(40);
      // Click = 460 / 4600 = 10.0%
      expect(body.summary.clickRate).toBe(10);
      // Bounce = 200 / 4800 = 4.17%
      expect(body.summary.bounceRate).toBe(4.17);

      expect(body.summary.statusBreakdown.SENT).toBe(10);
      expect(body.summary.statusBreakdown.DRAFT).toBe(3);
      expect(body.trackingNotice).toBeDefined();

      // Verify workspace scoping
      expect(prisma.campaign.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ workspaceId: "workspace-123" })
        })
      );
      expect(prisma.campaign.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: "workspace-123",
            status: { in: ["SENT", "SENDING", "PAUSED", "FAILED"] }
          })
        })
      );
    });

    it("handles empty workspace datasets cleanly with zero rates", async () => {
      prisma.campaign.count.mockResolvedValueOnce(0);
      prisma.campaign.groupBy.mockResolvedValueOnce([]);
      prisma.campaign.aggregate.mockResolvedValueOnce({
        _count: { id: 0 },
        _sum: {
          sendTotal: null,
          sendSucceeded: null,
          sendFailed: null,
          deliveredCount: null,
          bouncedCount: null,
          openedCount: null,
          clickedCount: null,
          complainedCount: null
        }
      });

      const { response, body } = await call("/analytics/overview?range=7d");

      expect(response.status).toBe(200);
      expect(body.summary.totalCampaigns).toBe(0);
      expect(body.summary.sentCampaigns).toBe(0);
      expect(body.summary.deliveryRate).toBe(0);
      expect(body.summary.openRate).toBe(0);
      expect(body.summary.clickRate).toBe(0);
      expect(body.summary.bounceRate).toBe(0);
    });

    it("rejects invalid date range with 400 status", async () => {
      const { response, body } = await call("/analytics/overview?range=custom&from=2026-12-31&to=2026-01-01");
      expect(response.status).toBe(400);
      expect(body.error).toMatch(/cannot be later/i);
    });
  });

  describe("GET /analytics/timeseries", () => {
    it("returns daily continuous timeline of campaign activity", async () => {
      const now = new Date();
      const campaign1 = {
        id: "c-1",
        name: "Welcome Promo",
        status: "SENT",
        sentAt: now,
        createdAt: now,
        sendTotal: 100,
        sendSucceeded: 98,
        sendFailed: 2,
        deliveredCount: 95,
        bouncedCount: 3,
        openedCount: 45,
        clickedCount: 15
      };

      prisma.campaign.findMany.mockResolvedValueOnce([campaign1]);

      const { response, body } = await call("/analytics/timeseries?range=7d");

      expect(response.status).toBe(200);
      expect(Array.isArray(body.timeseries)).toBe(true);
      expect(body.timeseries.length).toBeGreaterThanOrEqual(7);

      const todayKey = now.toISOString().slice(0, 10);
      const todayBucket = body.timeseries.find(b => b.date === todayKey);
      expect(todayBucket).toBeDefined();
      expect(todayBucket.campaignsCount).toBe(1);
      expect(todayBucket.submitted).toBe(98);
      expect(todayBucket.delivered).toBe(95);
      expect(todayBucket.opened).toBe(45);
      expect(todayBucket.clicked).toBe(15);
    });
  });

  describe("GET /analytics/top-campaigns", () => {
    it("returns top campaigns sorted and enriched with performance rates", async () => {
      const campaignA = {
        id: "c-a",
        name: "Campaign Alpha",
        subject: "Subject Alpha",
        status: "SENT",
        sentAt: new Date("2026-11-10T10:00:00Z"),
        createdAt: new Date("2026-11-10T09:00:00Z"),
        sendTotal: 1000,
        sendSucceeded: 1000,
        sendFailed: 0,
        deliveredCount: 1000,
        bouncedCount: 0,
        openedCount: 600, // 60% open rate
        clickedCount: 200,
        complainedCount: 0
      };

      const campaignB = {
        id: "c-b",
        name: "Campaign Beta",
        subject: "Subject Beta",
        status: "SENT",
        sentAt: new Date("2026-11-12T10:00:00Z"),
        createdAt: new Date("2026-11-12T09:00:00Z"),
        sendTotal: 500,
        sendSucceeded: 500,
        sendFailed: 0,
        deliveredCount: 500,
        bouncedCount: 0,
        openedCount: 100, // 20% open rate
        clickedCount: 50,
        complainedCount: 0
      };

      prisma.campaign.findMany.mockResolvedValueOnce([campaignB, campaignA]);

      const { response, body } = await call("/analytics/top-campaigns?sortBy=openRate");

      expect(response.status).toBe(200);
      expect(body.campaigns.length).toBe(2);
      // Campaign A should be first because 60% > 20%
      expect(body.campaigns[0].id).toBe("c-a");
      expect(body.campaigns[0].openRate).toBe(60);
      expect(body.campaigns[0].deliveryRate).toBe(100);
      expect(body.campaigns[1].id).toBe("c-b");
      expect(body.campaigns[1].openRate).toBe(20);
    });
  });

  describe("GET /analytics/failures", () => {
    it("returns failed and bounced recipient breakdown with workspace isolation", async () => {
      prisma.campaignRecipient.groupBy.mockResolvedValueOnce([
        { status: "FAILED", _count: { id: 14 } },
        { status: "BOUNCED", _count: { id: 6 } },
        { status: "COMPLAINED", _count: { id: 1 } }
      ]);

      prisma.campaignRecipient.findMany.mockResolvedValueOnce([
        {
          id: "cr-1",
          email: "bad@example.com",
          status: "BOUNCED",
          error: "Mailbox does not exist",
          attempts: 1,
          uncertain: false,
          lastAttemptAt: new Date(),
          bouncedAt: new Date(),
          campaign: { id: "camp-1", name: "Black Friday" }
        }
      ]);

      const { response, body } = await call("/analytics/failures?range=30d", {
        headers: { "x-test-workspace": "workspace-secure" }
      });

      expect(response.status).toBe(200);
      expect(body.breakdown.failed).toBe(14);
      expect(body.breakdown.bounced).toBe(6);
      expect(body.breakdown.complained).toBe(1);
      expect(body.breakdown.totalIssues).toBe(21);
      expect(body.recentFailures.length).toBe(1);
      expect(body.recentFailures[0].email).toBe("bad@example.com");
      expect(body.recentFailures[0].campaignName).toBe("Black Friday");

      expect(prisma.campaignRecipient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            campaign: expect.objectContaining({ workspaceId: "workspace-secure" })
          })
        })
      );
    });
  });

  describe("GET /analytics (Unified dashboard endpoint)", () => {
    it("bundles summary, timeseries, and top campaigns in a single roundtrip", async () => {
      prisma.campaign.count.mockResolvedValueOnce(8);
      prisma.campaign.aggregate.mockResolvedValueOnce({
        _count: { id: 6 },
        _sum: {
          sendTotal: 1200,
          sendSucceeded: 1150,
          sendFailed: 50,
          deliveredCount: 1100,
          bouncedCount: 50,
          openedCount: 440,
          clickedCount: 110,
          complainedCount: 2
        }
      });
      prisma.campaign.findMany.mockResolvedValueOnce([
        {
          id: "camp-top",
          name: "Top Campaign",
          subject: "Exclusive Preview",
          status: "SENT",
          sentAt: new Date(),
          createdAt: new Date(),
          sendTotal: 500,
          sendSucceeded: 500,
          sendFailed: 0,
          deliveredCount: 500,
          bouncedCount: 0,
          openedCount: 300,
          clickedCount: 100,
          complainedCount: 0
        }
      ]);

      const { response, body } = await call("/analytics?range=30d");

      expect(response.status).toBe(200);
      expect(body.summary).toBeDefined();
      expect(body.summary.totalCampaigns).toBe(8);
      expect(body.summary.openRate).toBe(40);
      expect(Array.isArray(body.timeseries)).toBe(true);
      expect(Array.isArray(body.topCampaigns)).toBe(true);
      expect(body.topCampaigns[0].id).toBe("camp-top");
      expect(body.trackingNotice).toBeDefined();
    });
  });

  describe("Role-based permissions & authentication", () => {
    it("rejects unauthenticated request with 401", async () => {
      const { response, body } = await call("/analytics/overview", {
        headers: { "x-test-unauthenticated": "true" }
      });
      expect(response.status).toBe(401);
      expect(body.error).toMatch(/sign in/i);
    });

    it("allows ANALYST and VIEWER roles to access analytics", async () => {
      prisma.campaign.count.mockResolvedValue(0);
      prisma.campaign.groupBy.mockResolvedValue([]);
      prisma.campaign.aggregate.mockResolvedValue({
        _count: { id: 0 },
        _sum: {}
      });

      const analystRes = await call("/analytics/overview", {
        headers: { "x-test-role": "ANALYST" }
      });
      expect(analystRes.response.status).toBe(200);

      const viewerRes = await call("/analytics/overview", {
        headers: { "x-test-role": "VIEWER" }
      });
      expect(viewerRes.response.status).toBe(200);
    });
  });
});
