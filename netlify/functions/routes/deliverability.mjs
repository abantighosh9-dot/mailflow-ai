// Email Deliverability & DNS Domain Authentication Routes for MailFlow AI
import express from "express";
import { z } from "zod";
import { prisma } from "../_lib/db.mjs";
import { auth as requireAuth, requireRole } from "../_lib/auth.mjs";
import {
  validateSafeDomain,
  generateDefaultDnsRecords,
  verifySingleRecord,
  calculateDomainHealthScore,
  getRegistrarInstructions
} from "../_lib/dns-verifier.mjs";
import { analyzeEmailSpamScore } from "../_lib/spam-analyzer.mjs";

const router = express.Router();

const domainCreateSchema = z.object({
  domain: z.string().trim().min(3, "Domain name is required").max(253, "Domain name too long"),
  dkimSelector: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]+$/, "Selector must only contain alphanumeric characters, underscores, or hyphens.")
    .max(30)
    .optional()
    .default("mailo"),
  trackingSubdomain: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]+$/, "Tracking subdomain must be alphanumeric.")
    .max(30)
    .optional()
    .default("track")
});

const spamCheckSchema = z.object({
  subject: z.string().trim().max(1000).optional().default(""),
  html: z.string().max(500000).optional().default(""),
  fromEmail: z.string().trim().email().optional().or(z.literal("")),
  campaignId: z.string().trim().optional()
});

/**
 * Helper to extract workspaceId safely from req
 */
function getWorkspaceId(req) {
  return req.workspace?.id || req.user?.workspaceId || null;
}

/**
 * GET /deliverability/overview
 * Workspace-scoped deliverability stats, health score, and alert thresholds.
 */
router.get("/deliverability/overview", requireAuth, async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.status(401).json({ error: "Workspace context missing." });

    // 1. Fetch all sending domains for this workspace
    const domains = await prisma.sendingDomain.findMany({
      where: { workspaceId },
      include: { dnsRecords: true },
      orderBy: { createdAt: "desc" }
    });

    // 2. Aggregate delivery metrics across campaigns
    const campaigns = await prisma.campaign.findMany({
      where: { workspaceId },
      select: {
        sendTotal: true,
        sendSucceeded: true,
        deliveredCount: true,
        bouncedCount: true,
        complainedCount: true,
        openedCount: true,
        clickedCount: true
      }
    });

    let totalSent = 0;
    let totalDelivered = 0;
    let totalBounced = 0;
    let totalComplained = 0;
    let totalOpened = 0;
    let totalClicked = 0;

    for (const c of campaigns) {
      totalSent += c.sendSucceeded || 0;
      totalDelivered += c.deliveredCount || 0;
      totalBounced += c.bouncedCount || 0;
      totalComplained += c.complainedCount || 0;
      totalOpened += c.openedCount || 0;
      totalClicked += c.clickedCount || 0;
    }

    const deliveryRate = totalSent > 0 ? Number(((totalDelivered / totalSent) * 100).toFixed(1)) : 100;
    const bounceRate = totalSent > 0 ? Number(((totalBounced / totalSent) * 100).toFixed(2)) : 0;
    const complaintRate = totalSent > 0 ? Number(((totalComplained / totalSent) * 100).toFixed(2)) : 0;
    const openRate = totalDelivered > 0 ? Number(((totalOpened / totalDelivered) * 100).toFixed(1)) : 0;
    const clickRate = totalDelivered > 0 ? Number(((totalClicked / totalDelivered) * 100).toFixed(1)) : 0;

    // 3. Calculate aggregate workspace domain health score
    let overallHealthScore = 85;
    if (domains.length > 0) {
      const avgScore = domains.reduce((sum, d) => sum + (d.healthScore || 50), 0) / domains.length;
      overallHealthScore = Math.round(avgScore);
    }

    // Adjust for bounce/complaint thresholds
    if (bounceRate > 5) overallHealthScore = Math.max(0, overallHealthScore - 20);
    if (complaintRate > 0.1) overallHealthScore = Math.max(0, overallHealthScore - 25);

    // 4. Fetch recent deliverability failure events (bounces & complaints)
    const recentFailures = await prisma.campaignRecipient.findMany({
      where: {
        campaign: { workspaceId },
        status: { in: ["BOUNCED", "COMPLAINED", "FAILED"] }
      },
      select: {
        id: true,
        email: true,
        status: true,
        sentAt: true,
        campaign: { select: { id: true, name: true } }
      },
      orderBy: { sentAt: "desc" },
      take: 10
    });

    const verifiedDomainsCount = domains.filter(d => d.status === "VERIFIED").length;

    return res.json({
      healthScore: overallHealthScore,
      status: overallHealthScore >= 80 ? "EXCELLENT" : overallHealthScore >= 60 ? "GOOD" : "NEEDS_ATTENTION",
      metrics: {
        totalSent,
        totalDelivered,
        totalBounced,
        totalComplained,
        totalOpened,
        totalClicked,
        deliveryRate,
        bounceRate,
        complaintRate,
        openRate,
        clickRate
      },
      domainsSummary: {
        total: domains.length,
        verified: verifiedDomainsCount,
        pending: domains.length - verifiedDomainsCount
      },
      alerts: {
        highBounceRate: bounceRate > 5,
        highComplaintRate: complaintRate > 0.1,
        noVerifiedDomain: domains.length === 0 || verifiedDomainsCount === 0
      },
      recentFailures
    });
  } catch (error) {
    console.error("Error fetching deliverability overview:", error);
    return res.status(500).json({ error: "Failed to load deliverability overview." });
  }
});

/**
 * GET /deliverability/domains
 * List all sending domains for the workspace.
 */
router.get("/deliverability/domains", requireAuth, async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.status(401).json({ error: "Workspace context missing." });

    const domains = await prisma.sendingDomain.findMany({
      where: { workspaceId },
      include: {
        dnsRecords: {
          orderBy: { purpose: "asc" }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    return res.json({ domains });
  } catch (error) {
    console.error("Error listing sending domains:", error);
    return res.status(500).json({ error: "Failed to fetch sending domains." });
  }
});

/**
 * POST /deliverability/domains
 * Add a new sending domain and automatically generate its DNS records.
 */
router.post(
  "/deliverability/domains",
  requireAuth,
  requireRole("OWNER", "ADMIN", "EDITOR"),
  async (req, res) => {
    try {
      const workspaceId = getWorkspaceId(req);
      if (!workspaceId) return res.status(401).json({ error: "Workspace context missing." });

      const parseResult = domainCreateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors
        });
      }

      const { domain: rawDomain, dkimSelector, trackingSubdomain } = parseResult.data;

      // Safe domain validation & SSRF protection
      const validation = validateSafeDomain(rawDomain);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.reason });
      }

      const domain = validation.domain;

      // Check for duplicate in this workspace
      const existing = await prisma.sendingDomain.findUnique({
        where: {
          workspaceId_domain: {
            workspaceId,
            domain
          }
        }
      });

      if (existing) {
        return res.status(409).json({ error: `Domain '${domain}' is already registered in this workspace.` });
      }

      // Generate default DNS records
      const defaultRecords = generateDefaultDnsRecords(domain, {
        dkimSelector,
        trackingSubdomain
      });

      // Create domain and DNS records in a transaction
      const newDomain = await prisma.$transaction(async tx => {
        const createdDomain = await tx.sendingDomain.create({
          data: {
            workspaceId,
            domain,
            dkimSelector,
            trackingSubdomain,
            status: "PENDING",
            spfStatus: "PENDING",
            dkimStatus: "PENDING",
            dmarcStatus: "PENDING",
            customTrackingStatus: "PENDING",
            healthScore: 50
          }
        });

        for (const rec of defaultRecords) {
          await tx.domainDnsRecord.create({
            data: {
              domainId: createdDomain.id,
              recordType: rec.recordType,
              name: rec.name,
              expectedValue: rec.expectedValue,
              purpose: rec.purpose,
              status: "PENDING"
            }
          });
        }

        return tx.sendingDomain.findUnique({
          where: { id: createdDomain.id },
          include: { dnsRecords: true }
        });
      });

      return res.status(201).json({
        domain: newDomain,
        instructions: getRegistrarInstructions(domain, "generic")
      });
    } catch (error) {
      console.error("Error creating sending domain:", error);
      return res.status(500).json({ error: "Failed to create sending domain." });
    }
  }
);

/**
 * GET /deliverability/domains/:id
 * Get details, DNS records, and registrar instructions for a domain.
 */
router.get("/deliverability/domains/:id", requireAuth, async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.status(401).json({ error: "Workspace context missing." });
    const { id } = req.params;

    const domain = await prisma.sendingDomain.findFirst({
      where: { id, workspaceId },
      include: {
        dnsRecords: {
          orderBy: { purpose: "asc" }
        },
        healthHistory: {
          orderBy: { recordedAt: "desc" },
          take: 7
        }
      }
    });

    if (!domain) {
      return res.status(404).json({ error: "Sending domain not found." });
    }

    const provider = req.query.provider || "generic";
    const instructions = getRegistrarInstructions(domain.domain, provider);

    return res.json({ domain, instructions });
  } catch (error) {
    console.error("Error retrieving sending domain:", error);
    return res.status(500).json({ error: "Failed to fetch sending domain details." });
  }
});

/**
 * POST /deliverability/domains/:id/verify
 * Execute live DNS queries for all domain records and update verification status.
 */
router.post(
  "/deliverability/domains/:id/verify",
  requireAuth,
  requireRole("OWNER", "ADMIN", "EDITOR"),
  async (req, res) => {
    try {
      const workspaceId = getWorkspaceId(req);
      if (!workspaceId) return res.status(401).json({ error: "Workspace context missing." });
      const { id } = req.params;

      const domain = await prisma.sendingDomain.findFirst({
        where: { id, workspaceId },
        include: { dnsRecords: true }
      });

      if (!domain) {
        return res.status(404).json({ error: "Sending domain not found." });
      }

      // Verify each DNS record
      const verificationResults = [];
      for (const rec of domain.dnsRecords) {
        const result = await verifySingleRecord(rec, domain.domain);
        verificationResults.push(result);
      }

      // Determine statuses per purpose
      const spfResult = verificationResults.find(r => r.purpose === "SPF");
      const dkimResult = verificationResults.find(r => r.purpose === "DKIM");
      const dmarcResult = verificationResults.find(r => r.purpose === "DMARC");
      const trackingResult = verificationResults.find(r => r.purpose === "TRACKING");

      const spfStatus = spfResult?.status || "PENDING";
      const dkimStatus = dkimResult?.status || "PENDING";
      const dmarcStatus = dmarcResult?.status || "PENDING";
      const trackingStatus = trackingResult?.status || "PENDING";

      // Overall status: VERIFIED if both SPF and DKIM pass
      let overallStatus = "PENDING";
      if (spfStatus === "VERIFIED" && dkimStatus === "VERIFIED") {
        overallStatus = "VERIFIED";
      } else if (spfStatus === "INVALID" || dkimStatus === "INVALID") {
        overallStatus = "FAILED";
      }

      const healthScore = calculateDomainHealthScore({
        spfStatus,
        dkimStatus,
        dmarcStatus,
        customTrackingStatus: trackingStatus
      });

      // Update records in DB
      const updatedDomain = await prisma.$transaction(async tx => {
        for (const res of verificationResults) {
          await tx.domainDnsRecord.update({
            where: { id: res.id },
            data: {
              status: res.status,
              actualValue: res.actualValue,
              errorMessage: res.errorMessage,
              lastCheckedAt: res.lastCheckedAt
            }
          });
        }

        const savedDomain = await tx.sendingDomain.update({
          where: { id },
          data: {
            status: overallStatus,
            spfStatus,
            dkimStatus,
            dmarcStatus,
            customTrackingStatus: trackingStatus,
            healthScore,
            lastVerifiedAt: new Date()
          },
          include: {
            dnsRecords: {
              orderBy: { purpose: "asc" }
            }
          }
        });

        // Record health snapshot
        await tx.domainHealthHistory.create({
          data: {
            domainId: id,
            healthScore,
            spfOk: spfStatus === "VERIFIED",
            dkimOk: dkimStatus === "VERIFIED",
            dmarcOk: dmarcStatus === "VERIFIED",
            trackingOk: trackingStatus === "VERIFIED"
          }
        });

        return savedDomain;
      });

      return res.json({
        domain: updatedDomain,
        message:
          overallStatus === "VERIFIED"
            ? `Domain ${domain.domain} verified successfully!`
            : "Verification completed. Some records are still missing or invalid."
      });
    } catch (error) {
      console.error("Error during domain verification:", error);
      return res.status(500).json({ error: "Failed to verify sending domain DNS records." });
    }
  }
);

/**
 * DELETE /deliverability/domains/:id
 * Delete a sending domain.
 */
router.delete(
  "/deliverability/domains/:id",
  requireAuth,
  requireRole("OWNER", "ADMIN"),
  async (req, res) => {
    try {
      const workspaceId = getWorkspaceId(req);
      if (!workspaceId) return res.status(401).json({ error: "Workspace context missing." });
      const { id } = req.params;

      const domain = await prisma.sendingDomain.findFirst({
        where: { id, workspaceId }
      });

      if (!domain) {
        return res.status(404).json({ error: "Sending domain not found." });
      }

      await prisma.sendingDomain.delete({
        where: { id }
      });

      return res.json({ success: true, message: `Domain ${domain.domain} deleted successfully.` });
    } catch (error) {
      console.error("Error deleting sending domain:", error);
      return res.status(500).json({ error: "Failed to delete sending domain." });
    }
  }
);

/**
 * POST /deliverability/analyze-spam
 * Pre-send email content spam score analyzer.
 */
router.post("/deliverability/analyze-spam", requireAuth, async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);

    const parseResult = spamCheckSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors
      });
    }

    const { subject, html, fromEmail, campaignId } = parseResult.data;

    const analysis = analyzeEmailSpamScore({ subject, html, fromEmail });

    // If campaignId was provided, record check in DB
    if (campaignId) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, workspaceId }
      });

      if (campaign) {
        await prisma.deliverabilityCheck.create({
          data: {
            workspaceId,
            campaignId,
            subject: subject || campaign.subject,
            score: analysis.score,
            riskLevel: analysis.riskLevel,
            issues: analysis.issues,
            suggestions: analysis.suggestions
          }
        });
      }
    }

    return res.json(analysis);
  } catch (error) {
    console.error("Error analyzing spam score:", error);
    return res.status(500).json({ error: "Failed to analyze email content." });
  }
});

/**
 * GET /deliverability/instructions/:provider
 * Get registrar setup instructions for a specific provider.
 */
router.get("/deliverability/instructions/:provider", requireAuth, (req, res) => {
  const provider = req.params.provider || "generic";
  const domain = req.query.domain || "yourdomain.com";
  const instructions = getRegistrarInstructions(domain, provider);
  return res.json({ instructions });
});

export default router;
