// MailFlow AI — Campaign Analytics Backend API
import express from "express";
import { z } from "zod";
import { prisma } from "../_lib/db.mjs";
import { auth, requireRole } from "../_lib/auth.mjs";

const router = express.Router();

/**
 * Validates and parses query parameters for date-range filtering.
 * Supported ranges: 7d, 30d, 90d, custom.
 */
export const dateRangeSchema = z.object({
  range: z.enum(["7d", "30d", "90d", "custom"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortBy: z.enum(["openRate", "clickRate", "delivered", "sent", "createdAt"]).optional(),
  limit: z.coerce.number().min(1).max(100).optional()
});

/**
 * Calculates start and end Date objects based on the requested range.
 * Throws an Error with 400 status semantics if the range is invalid.
 */
export function parseDateFilter(query, now = new Date()) {
  const range = query.range || "30d";
  let startDate;
  let endDate = new Date(now);

  if (range === "7d") {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (range === "30d") {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (range === "90d") {
    startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  } else if (range === "custom") {
    const rawStart = query.startDate || query.from;
    const rawEnd = query.endDate || query.to;

    if (!rawStart || !rawEnd) {
      const err = new Error("Custom date range requires both start and end dates (e.g. ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD).");
      err.status = 400;
      throw err;
    }

    startDate = new Date(rawStart);
    endDate = new Date(rawEnd);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      const err = new Error("Invalid date format. Please supply ISO date strings (e.g. YYYY-MM-DD).");
      err.status = 400;
      throw err;
    }

    if (startDate > endDate) {
      const err = new Error("startDate cannot be later than endDate.");
      err.status = 400;
      throw err;
    }

    // Set end date to end of that day (23:59:59.999) if only date was provided
    if (!rawEnd.includes("T")) {
      endDate.setHours(23, 59, 59, 999);
    }
  } else {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return { range, startDate, endDate };
}

/**
 * Safely calculates delivery and engagement percentage rates.
 * Returns 0 instead of NaN or Infinity when denominators are 0.
 * Rates are percentages rounded to 2 decimal places (e.g. 42.50).
 */
export function calculateRates(stats) {
  const submitted = Number(stats.sendSucceeded || 0);
  const delivered = Number(stats.deliveredCount || 0);
  const opened = Number(stats.openedCount || 0);
  const clicked = Number(stats.clickedCount || 0);
  const bounced = Number(stats.bouncedCount || 0);

  // Delivery rate = delivered / successfully submitted
  const deliveryRate = submitted > 0
    ? Math.min(Math.round((delivered / submitted) * 10000) / 100, 100)
    : 0;

  // Open rate = unique recipients opened / delivered
  const openRate = delivered > 0
    ? Math.min(Math.round((opened / delivered) * 10000) / 100, 100)
    : 0;

  // Click rate = unique recipients clicked / delivered
  const clickRate = delivered > 0
    ? Math.min(Math.round((clicked / delivered) * 10000) / 100, 100)
    : 0;

  // Bounce rate = bounced / successfully submitted
  const bounceRate = submitted > 0
    ? Math.min(Math.round((bounced / submitted) * 10000) / 100, 100)
    : 0;

  return {
    deliveryRate,
    openRate,
    clickRate,
    bounceRate
  };
}

/**
 * Builds where clause scoped to workspace and optional date range.
 */
export function buildAnalyticsWhere(workspaceId, { startDate, endDate, statuses } = {}) {
  const where = { workspaceId };

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = startDate;
    if (endDate) where.createdAt.lte = endDate;
  }

  if (statuses && statuses.length > 0) {
    where.status = { in: statuses };
  }

  return where;
}

const TRACKING_LIMITATIONS_NOTICE =
  "Metrics reflect transactional events recorded via Brevo SMTP API and verified webhooks. " +
  "Opens rely on a 1x1 invisible pixel and clicks on link tracking. " +
  "Client-side image blocking or Apple Mail Privacy Protection (MPP) can prevent open tracking from recording.";

// Middleware pipeline for all analytics routes
const analyticsAuth = [
  auth,
  requireRole("OWNER", "ADMIN", "EDITOR", "ANALYST", "VIEWER")
];

// =========================================================================
// 1. GET /analytics/overview — Overall campaign performance & rates
// =========================================================================
router.get("/analytics/overview", ...analyticsAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(400).json({ error: "Workspace context is missing." });
  }

  try {
    const parseResult = dateRangeSchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0]?.message || "Invalid query parameters." });
    }

    const { range, startDate, endDate } = parseDateFilter(parseResult.data);

    // 1. Total campaigns count in period (including drafts)
    const totalCampaigns = await prisma.campaign.count({
      where: buildAnalyticsWhere(workspaceId, { startDate, endDate })
    });

    // 2. Status breakdown
    const statusGroups = await prisma.campaign.groupBy({
      by: ["status"],
      where: buildAnalyticsWhere(workspaceId, { startDate, endDate }),
      _count: { id: true }
    });

    const statusBreakdown = {
      DRAFT: 0,
      SCHEDULED: 0,
      QUEUED: 0,
      SENDING: 0,
      SENT: 0,
      PAUSED: 0,
      CANCELLED: 0,
      FAILED: 0
    };
    for (const g of statusGroups) {
      statusBreakdown[g.status] = g._count.id;
    }

    // 3. Aggregate performance across active/dispatched campaigns (exclude DRAFT and CANCELLED)
    const activeWhere = buildAnalyticsWhere(workspaceId, {
      startDate,
      endDate,
      statuses: ["SENT", "SENDING", "PAUSED", "FAILED"]
    });

    const aggregates = await prisma.campaign.aggregate({
      where: activeWhere,
      _sum: {
        sendTotal: true,
        sendSucceeded: true,
        sendFailed: true,
        deliveredCount: true,
        bouncedCount: true,
        openedCount: true,
        clickedCount: true,
        complainedCount: true
      },
      _count: {
        id: true
      }
    });

    const sum = aggregates._sum || {};
    const sentCampaignsCount = aggregates._count?.id || 0;

    const rawMetrics = {
      totalCampaigns,
      sentCampaigns: sentCampaignsCount,
      targetedRecipients: sum.sendTotal || 0,
      submitted: sum.sendSucceeded || 0,
      delivered: sum.deliveredCount || 0,
      failed: sum.sendFailed || 0,
      bounced: sum.bouncedCount || 0,
      opened: sum.openedCount || 0,
      clicked: sum.clickedCount || 0,
      complained: sum.complainedCount || 0
    };

    const rates = calculateRates({
      sendSucceeded: rawMetrics.submitted,
      deliveredCount: rawMetrics.delivered,
      openedCount: rawMetrics.opened,
      clickedCount: rawMetrics.clicked,
      bouncedCount: rawMetrics.bounced
    });

    return res.json({
      summary: {
        ...rawMetrics,
        ...rates,
        statusBreakdown
      },
      dateRange: {
        range,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      },
      trackingNotice: TRACKING_LIMITATIONS_NOTICE
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error("GET /analytics/overview failed", err);
    return res.status(500).json({ error: "Failed to generate campaign overview analytics." });
  }
});

// =========================================================================
// 2. GET /analytics/timeseries — Campaign performance grouped over time
// =========================================================================
router.get("/analytics/timeseries", ...analyticsAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(400).json({ error: "Workspace context is missing." });
  }

  try {
    const parseResult = dateRangeSchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0]?.message || "Invalid query parameters." });
    }

    const { range, startDate, endDate } = parseDateFilter(parseResult.data);

    // Fetch dispatched campaigns in date window
    const campaigns = await prisma.campaign.findMany({
      where: buildAnalyticsWhere(workspaceId, {
        startDate,
        endDate,
        statuses: ["SENT", "SENDING", "PAUSED", "FAILED"]
      }),
      select: {
        id: true,
        name: true,
        status: true,
        sentAt: true,
        createdAt: true,
        sendTotal: true,
        sendSucceeded: true,
        sendFailed: true,
        deliveredCount: true,
        bouncedCount: true,
        openedCount: true,
        clickedCount: true
      },
      orderBy: { createdAt: "asc" }
    });

    // Bucket campaigns by day (YYYY-MM-DD)
    const dayBuckets = new Map();

    // Initialize all days in date range for a continuous timeline
    const cur = new Date(startDate);
    cur.setHours(0, 0, 0, 0);
    const endMidnight = new Date(endDate);
    endMidnight.setHours(23, 59, 59, 999);

    while (cur <= endMidnight) {
      const key = cur.toISOString().slice(0, 10);
      dayBuckets.set(key, {
        date: key,
        campaignsCount: 0,
        targeted: 0,
        submitted: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        failed: 0
      });
      cur.setDate(cur.getDate() + 1);
    }

    // Accumulate metrics into respective day buckets
    for (const c of campaigns) {
      const targetDate = c.sentAt || c.createdAt;
      const key = new Date(targetDate).toISOString().slice(0, 10);
      let bucket = dayBuckets.get(key);
      if (!bucket) {
        bucket = {
          date: key,
          campaignsCount: 0,
          targeted: 0,
          submitted: 0,
          delivered: 0,
          opened: 0,
          clicked: 0,
          bounced: 0,
          failed: 0
        };
        dayBuckets.set(key, bucket);
      }

      bucket.campaignsCount += 1;
      bucket.targeted += c.sendTotal || 0;
      bucket.submitted += c.sendSucceeded || 0;
      bucket.delivered += c.deliveredCount || 0;
      bucket.opened += c.openedCount || 0;
      bucket.clicked += c.clickedCount || 0;
      bucket.bounced += c.bouncedCount || 0;
      bucket.failed += c.sendFailed || 0;
    }

    const timeseries = Array.from(dayBuckets.values()).sort((a, b) => a.date.localeCompare(b.date));

    return res.json({
      timeseries,
      dateRange: {
        range,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      }
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error("GET /analytics/timeseries failed", err);
    return res.status(500).json({ error: "Failed to generate campaign timeseries." });
  }
});

// =========================================================================
// 3. GET /analytics/top-campaigns — Top performing campaigns with rates
// =========================================================================
router.get("/analytics/top-campaigns", ...analyticsAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(400).json({ error: "Workspace context is missing." });
  }

  try {
    const parseResult = dateRangeSchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0]?.message || "Invalid query parameters." });
    }

    const { startDate, endDate } = parseDateFilter(parseResult.data);
    const limit = parseResult.data.limit || 10;
    const sortBy = parseResult.data.sortBy || "openRate";

    const campaigns = await prisma.campaign.findMany({
      where: buildAnalyticsWhere(workspaceId, {
        startDate,
        endDate,
        statuses: ["SENT", "SENDING", "PAUSED", "FAILED"]
      }),
      select: {
        id: true,
        name: true,
        subject: true,
        status: true,
        sentAt: true,
        createdAt: true,
        sendTotal: true,
        sendSucceeded: true,
        sendFailed: true,
        deliveredCount: true,
        bouncedCount: true,
        openedCount: true,
        clickedCount: true,
        complainedCount: true
      }
    });

    const enriched = campaigns.map(c => {
      const rates = calculateRates({
        sendSucceeded: c.sendSucceeded,
        deliveredCount: c.deliveredCount,
        openedCount: c.openedCount,
        clickedCount: c.clickedCount,
        bouncedCount: c.bouncedCount
      });
      return {
        id: c.id,
        name: c.name,
        subject: c.subject,
        status: c.status,
        sentAt: c.sentAt,
        createdAt: c.createdAt,
        sendTotal: c.sendTotal,
        submitted: c.sendSucceeded,
        delivered: c.deliveredCount,
        failed: c.sendFailed,
        bounced: c.bouncedCount,
        opened: c.openedCount,
        clicked: c.clickedCount,
        complained: c.complainedCount,
        ...rates
      };
    });

    // In-memory sort by requested metric
    enriched.sort((a, b) => {
      if (sortBy === "openRate") return b.openRate - a.openRate || b.delivered - a.delivered;
      if (sortBy === "clickRate") return b.clickRate - a.clickRate || b.delivered - a.delivered;
      if (sortBy === "delivered") return b.delivered - a.delivered;
      if (sortBy === "sent") return b.submitted - a.submitted;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return res.json({
      campaigns: enriched.slice(0, limit)
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error("GET /analytics/top-campaigns failed", err);
    return res.status(500).json({ error: "Failed to fetch top campaigns." });
  }
});

// =========================================================================
// 4. GET /analytics/recent-activity — Recent campaigns with live status
// =========================================================================
router.get("/analytics/recent-activity", ...analyticsAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(400).json({ error: "Workspace context is missing." });
  }

  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

    const recent = await prisma.campaign.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        name: true,
        subject: true,
        status: true,
        scheduledAt: true,
        sentAt: true,
        completedAt: true,
        updatedAt: true,
        sendTotal: true,
        sendSucceeded: true,
        sendFailed: true,
        deliveredCount: true,
        openedCount: true,
        clickedCount: true
      }
    });

    const activity = recent.map(c => ({
      ...c,
      ...calculateRates(c)
    }));

    return res.json({ activity });
  } catch (err) {
    console.error("GET /analytics/recent-activity failed", err);
    return res.status(500).json({ error: "Failed to fetch recent activity." });
  }
});

// =========================================================================
// 5. GET /analytics/failures — Failed and bounced recipients breakdown
// =========================================================================
router.get("/analytics/failures", ...analyticsAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(400).json({ error: "Workspace context is missing." });
  }

  try {
    const parseResult = dateRangeSchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0]?.message || "Invalid query parameters." });
    }

    const { startDate, endDate } = parseDateFilter(parseResult.data);
    const limit = parseResult.data.limit || 20;

    // Filter recipients belonging to campaigns of this workspace
    const recipientWhere = {
      campaign: {
        workspaceId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      status: { in: ["FAILED", "BOUNCED", "COMPLAINED"] }
    };

    // 1. Group by recipient status
    const statusGroups = await prisma.campaignRecipient.groupBy({
      by: ["status"],
      where: recipientWhere,
      _count: { id: true }
    });

    let failedCount = 0;
    let bouncedCount = 0;
    let complainedCount = 0;
    for (const g of statusGroups) {
      if (g.status === "FAILED") failedCount = g._count.id;
      if (g.status === "BOUNCED") bouncedCount = g._count.id;
      if (g.status === "COMPLAINED") complainedCount = g._count.id;
    }

    // 2. Fetch recent failed/bounced recipients with details
    const recentRecipients = await prisma.campaignRecipient.findMany({
      where: recipientWhere,
      take: limit,
      orderBy: { lastAttemptAt: "desc" },
      select: {
        id: true,
        email: true,
        status: true,
        error: true,
        attempts: true,
        uncertain: true,
        lastAttemptAt: true,
        bouncedAt: true,
        campaign: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    return res.json({
      breakdown: {
        failed: failedCount,
        bounced: bouncedCount,
        complained: complainedCount,
        totalIssues: failedCount + bouncedCount + complainedCount
      },
      recentFailures: recentRecipients.map(r => ({
        id: r.id,
        email: r.email,
        campaignId: r.campaign?.id,
        campaignName: r.campaign?.name || "Unknown Campaign",
        status: r.status,
        error: r.error || "No specific error reported",
        attempts: r.attempts,
        uncertain: r.uncertain,
        occurredAt: r.lastAttemptAt || r.bouncedAt
      }))
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error("GET /analytics/failures failed", err);
    return res.status(500).json({ error: "Failed to fetch delivery failure summary." });
  }
});

// =========================================================================
// 6. GET /analytics — Unified dashboard endpoint for single-roundtrip load
// =========================================================================
router.get("/analytics", ...analyticsAuth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(400).json({ error: "Workspace context is missing." });
  }

  try {
    const parseResult = dateRangeSchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0]?.message || "Invalid query parameters." });
    }

    const { range, startDate, endDate } = parseDateFilter(parseResult.data);

    // Run summary, timeseries query, and top campaigns concurrently
    const [totalCampaigns, aggregates, campaigns] = await Promise.all([
      prisma.campaign.count({
        where: buildAnalyticsWhere(workspaceId, { startDate, endDate })
      }),
      prisma.campaign.aggregate({
        where: buildAnalyticsWhere(workspaceId, {
          startDate,
          endDate,
          statuses: ["SENT", "SENDING", "PAUSED", "FAILED"]
        }),
        _sum: {
          sendTotal: true,
          sendSucceeded: true,
          sendFailed: true,
          deliveredCount: true,
          bouncedCount: true,
          openedCount: true,
          clickedCount: true,
          complainedCount: true
        },
        _count: { id: true }
      }),
      prisma.campaign.findMany({
        where: buildAnalyticsWhere(workspaceId, {
          startDate,
          endDate,
          statuses: ["SENT", "SENDING", "PAUSED", "FAILED"]
        }),
        select: {
          id: true,
          name: true,
          subject: true,
          status: true,
          sentAt: true,
          createdAt: true,
          sendTotal: true,
          sendSucceeded: true,
          sendFailed: true,
          deliveredCount: true,
          bouncedCount: true,
          openedCount: true,
          clickedCount: true,
          complainedCount: true
        },
        orderBy: { createdAt: "asc" }
      })
    ]);

    const sum = aggregates._sum || {};
    const rawMetrics = {
      totalCampaigns,
      sentCampaigns: aggregates._count?.id || 0,
      targetedRecipients: sum.sendTotal || 0,
      submitted: sum.sendSucceeded || 0,
      delivered: sum.deliveredCount || 0,
      failed: sum.sendFailed || 0,
      bounced: sum.bouncedCount || 0,
      opened: sum.openedCount || 0,
      clicked: sum.clickedCount || 0,
      complained: sum.complainedCount || 0
    };

    const rates = calculateRates({
      sendSucceeded: rawMetrics.submitted,
      deliveredCount: rawMetrics.delivered,
      openedCount: rawMetrics.opened,
      clickedCount: rawMetrics.clicked,
      bouncedCount: rawMetrics.bounced
    });

    // Build daily timeseries
    const dayBuckets = new Map();
    const cur = new Date(startDate);
    cur.setHours(0, 0, 0, 0);
    const endMidnight = new Date(endDate);
    endMidnight.setHours(23, 59, 59, 999);

    while (cur <= endMidnight) {
      const key = cur.toISOString().slice(0, 10);
      dayBuckets.set(key, {
        date: key,
        campaignsCount: 0,
        targeted: 0,
        submitted: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        failed: 0
      });
      cur.setDate(cur.getDate() + 1);
    }

    const topCampaignsList = campaigns.map(c => {
      const targetDate = c.sentAt || c.createdAt;
      const key = new Date(targetDate).toISOString().slice(0, 10);
      let bucket = dayBuckets.get(key);
      if (!bucket) {
        bucket = {
          date: key,
          campaignsCount: 0,
          targeted: 0,
          submitted: 0,
          delivered: 0,
          opened: 0,
          clicked: 0,
          bounced: 0,
          failed: 0
        };
        dayBuckets.set(key, bucket);
      }
      bucket.campaignsCount += 1;
      bucket.targeted += c.sendTotal || 0;
      bucket.submitted += c.sendSucceeded || 0;
      bucket.delivered += c.deliveredCount || 0;
      bucket.opened += c.openedCount || 0;
      bucket.clicked += c.clickedCount || 0;
      bucket.bounced += c.bouncedCount || 0;
      bucket.failed += c.sendFailed || 0;

      const cRates = calculateRates({
        sendSucceeded: c.sendSucceeded,
        deliveredCount: c.deliveredCount,
        openedCount: c.openedCount,
        clickedCount: c.clickedCount,
        bouncedCount: c.bouncedCount
      });

      return {
        id: c.id,
        name: c.name,
        subject: c.subject,
        status: c.status,
        sentAt: c.sentAt,
        createdAt: c.createdAt,
        sendTotal: c.sendTotal,
        submitted: c.sendSucceeded,
        delivered: c.deliveredCount,
        failed: c.sendFailed,
        bounced: c.bouncedCount,
        opened: c.openedCount,
        clicked: c.clickedCount,
        complained: c.complainedCount,
        ...cRates
      };
    });

    topCampaignsList.sort((a, b) => b.openRate - a.openRate || b.delivered - a.delivered);

    return res.json({
      summary: {
        ...rawMetrics,
        ...rates
      },
      timeseries: Array.from(dayBuckets.values()).sort((a, b) => a.date.localeCompare(b.date)),
      topCampaigns: topCampaignsList.slice(0, 10),
      dateRange: {
        range,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      },
      trackingNotice: TRACKING_LIMITATIONS_NOTICE
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error("GET /analytics failed", err);
    return res.status(500).json({ error: "Failed to load analytics dashboard data." });
  }
});

export default router;
