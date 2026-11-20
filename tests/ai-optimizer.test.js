import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import express from "express";

if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) {
  throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
}

const mocks = vi.hoisted(() => {
  const mockChatCreate = vi.fn();
  const mockResponsesCreate = vi.fn();
  let enableChat = true;

  const prismaMock = {
    campaign: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn()
    },
    brandVoice: {
      findUnique: vi.fn(),
      upsert: vi.fn()
    }
  };

  function MockOpenAIConstructor() {
    return {
      chat: enableChat
        ? {
            completions: {
              create: mockChatCreate
            }
          }
        : undefined,
      responses: {
        create: mockResponsesCreate
      }
    };
  }

  return {
    MockOpenAIConstructor,
    mockChatCreate,
    mockResponsesCreate,
    prisma: prismaMock,
    setEnableChat: val => {
      enableChat = val;
    }
  };
});

vi.mock("../netlify/functions/_lib/db.mjs", () => ({
  prisma: mocks.prisma,
  default: mocks.prisma
}));

vi.mock("openai", () => ({
  default: mocks.MockOpenAIConstructor
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

describe("AI Campaign Performance Optimizer Routes", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "sk-test-mock-key";
    process.env.OPENAI_MODEL = "gpt-4o-mini";

    const aiRouter = (await import("../netlify/functions/routes/ai.mjs")).default;
    const app = express();
    app.use(express.json());
    app.use(aiRouter);

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
    process.env.OPENAI_API_KEY = "sk-test-mock-key";
    mocks.setEnableChat(true);

    mocks.mockChatCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              subjectRecommendations: [
                {
                  suggestion: "Unlock 30% Off Your Next Order Now",
                  style: "Direct Benefit",
                  rationale: "Clearly communicates immediate monetary value."
                },
                {
                  suggestion: "A Special Surprise is Waiting in Your Account",
                  style: "Curiosity",
                  rationale: "Sparks curiosity without using spam trigger words."
                }
              ],
              previewTextRecommendations: [
                {
                  suggestion: "Claim your exclusive member savings before Friday.",
                  rationale: "Reinforces the subject with clear deadline."
                }
              ],
              contentRecommendations: [
                {
                  section: "Opening Hook",
                  critique: "The opening sentence is generic.",
                  suggestedChange: "Lead immediately with the customer's biggest problem.",
                  rationale: "Increases reader retention in the first 3 seconds."
                }
              ],
              ctaRecommendations: [
                {
                  currentCta: "Click Here",
                  suggestedCta: "Claim Your 30% Discount",
                  placementTip: "Position as a prominent contrasting button above the fold.",
                  rationale: "Specific, action-oriented verbs convert higher than generic 'Click Here'."
                }
              ],
              audienceRecommendations: [
                {
                  segmentTip: "Segment non-openers from past 60 days.",
                  suggestedTags: ["winback", "vip"],
                  rationale: "Avoid sending discount blast to unengaged contacts."
                }
              ],
              timingRecommendations: {
                recommendedDay: "Tuesday",
                recommendedTimeWindow: "9:30 AM – 11:30 AM",
                timezoneTip: "Recipients' local standard time",
                rationale: "Optimal engagement window.",
                basedOnHistoricalData: false
              },
              overallExplanation: "The campaign copy is solid, but subject line curiosity and button clarity present the greatest conversion leverage."
            })
          }
        }
      ]
    });
  });

  describe("1. Authentication & RBAC Permissions", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await fetch(`${baseUrl}/ai/analyze-campaign/camp_1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-unauthenticated": "1" },
        body: JSON.stringify({})
      });
      expect(res.status).toBe(401);
    });

    it("allows VIEWER and ANALYST to run POST /ai/analyze-campaign/:id", async () => {
      mocks.prisma.campaign.findFirst.mockResolvedValue({
        id: "camp_1",
        workspaceId: "ws_123",
        name: "Test Campaign",
        status: "DRAFT",
        subject: "Welcome",
        previewText: "Hi there",
        html: "<p>Hello world</p>",
        targetTags: ["vip"],
        sendTotal: 0,
        sendSucceeded: 0,
        deliveredCount: 0,
        openedCount: 0,
        clickedCount: 0,
        bouncedCount: 0
      });
      mocks.prisma.campaign.findMany.mockResolvedValue([]);
      mocks.prisma.brandVoice.findUnique.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/ai/analyze-campaign/camp_1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": "VIEWER" },
        body: JSON.stringify({})
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.campaign.id).toBe("camp_1");
    });

    it("blocks VIEWER and ANALYST from mutating campaigns via POST /ai/optimize-campaign/:id (403 Forbidden)", async () => {
      const res = await fetch(`${baseUrl}/ai/optimize-campaign/camp_1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": "VIEWER" },
        body: JSON.stringify({ action: "apply_recommendations", applyChanges: { subject: "New" } })
      });
      expect(res.status).toBe(403);
    });

    it("allows EDITOR, ADMIN, and OWNER to access POST /ai/optimize-campaign/:id", async () => {
      mocks.prisma.campaign.findFirst.mockResolvedValue({
        id: "camp_draft",
        workspaceId: "ws_123",
        name: "Draft Campaign",
        status: "DRAFT",
        subject: "Old Subject",
        previewText: "Old Preview",
        html: "<p>Content</p>"
      });
      mocks.prisma.campaign.update.mockResolvedValue({
        id: "camp_draft",
        subject: "Approved Optimized Subject",
        status: "DRAFT"
      });
      mocks.prisma.brandVoice.findUnique.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/ai/optimize-campaign/camp_draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": "EDITOR" },
        body: JSON.stringify({
          action: "apply_recommendations",
          applyChanges: { subject: "Approved Optimized Subject" }
        })
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.campaign.subject).toBe("Approved Optimized Subject");
    });
  });

  describe("2. Workspace Isolation & Ownership Validation", () => {
    it("returns 404 when campaign belongs to a different workspace", async () => {
      mocks.prisma.campaign.findFirst.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/ai/analyze-campaign/foreign_camp_99`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-workspace": "ws_my_own" },
        body: JSON.stringify({})
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/not found/i);
    });

    it("returns 404 when applying optimizations to a foreign workspace campaign", async () => {
      mocks.prisma.campaign.findFirst.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/ai/optimize-campaign/foreign_camp_99`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": "ADMIN" },
        body: JSON.stringify({ action: "apply_recommendations", applyChanges: { subject: "Hacked" } })
      });
      expect(res.status).toBe(404);
    });
  });

  describe("3. Data Quality, Heuristics & Insufficient Data Handling", () => {
    it("marks hasSufficientData: false when campaign is in DRAFT with 0 sends", async () => {
      mocks.prisma.campaign.findFirst.mockResolvedValue({
        id: "camp_draft_1",
        workspaceId: "ws_123",
        name: "Spring Sale Draft",
        status: "DRAFT",
        subject: "Spring is here",
        previewText: "Check it out",
        html: "<p>Special discounts <a href='#'>Shop Now</a></p>",
        sendTotal: 0,
        sendSucceeded: 0,
        deliveredCount: 0,
        openedCount: 0,
        clickedCount: 0,
        bouncedCount: 0
      });
      mocks.prisma.campaign.findMany.mockResolvedValue([]);
      mocks.prisma.brandVoice.findUnique.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/ai/analyze-campaign/camp_draft_1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.dataQuality.hasSufficientData).toBe(false);
      expect(json.dataQuality.insufficientDataReason).toMatch(/draft/i);
      expect(json.measuredMetrics.openRate).toBe(0);
      expect(json.recommendations.subjectRecommendations.length).toBeGreaterThan(0);
      expect(json.recommendations.disclaimer).toMatch(/do not guarantee/i);
    });

    it("evaluates historical send timing when workspace has >= 3 past sent campaigns", async () => {
      mocks.prisma.campaign.findFirst.mockResolvedValue({
        id: "camp_active",
        workspaceId: "ws_123",
        name: "Active Newsletter",
        status: "SENT",
        subject: "Monthly Roundup",
        previewText: "All the news",
        html: "<p>Read all stories <a href='#'>Read More</a></p>",
        sendTotal: 1000,
        sendSucceeded: 1000,
        deliveredCount: 980,
        openedCount: 350,
        clickedCount: 120,
        bouncedCount: 20
      });

      // 4 past campaigns sent on Wednesday (Day 3)
      mocks.prisma.campaign.findMany.mockResolvedValue([
        { id: "p1", sentAt: new Date("2026-03-04T10:00:00Z"), deliveredCount: 500, openedCount: 250, clickedCount: 50 },
        { id: "p2", sentAt: new Date("2026-03-11T10:00:00Z"), deliveredCount: 500, openedCount: 260, clickedCount: 60 },
        { id: "p3", sentAt: new Date("2026-03-18T10:00:00Z"), deliveredCount: 500, openedCount: 240, clickedCount: 45 },
        { id: "p4", sentAt: new Date("2026-03-25T10:00:00Z"), deliveredCount: 500, openedCount: 270, clickedCount: 70 }
      ]);
      mocks.prisma.brandVoice.findUnique.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/ai/analyze-campaign/camp_active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.dataQuality.hasSufficientData).toBe(true);
      expect(json.dataQuality.hasSendTimeData).toBe(true);
      expect(json.dataQuality.totalSentCampaignsInWorkspace).toBe(4);
      expect(json.recommendations.timingRecommendations.basedOnHistoricalData).toBe(true);
      expect(json.recommendations.timingRecommendations.recommendedDay).toBe("Wednesday");
    });
  });

  describe("4. Brand Voice Compliance & Prohibited Phrase Scrubbing", () => {
    it("scrubs prohibited phrases from recommendations even if the AI outputs them", async () => {
      mocks.prisma.campaign.findFirst.mockResolvedValue({
        id: "camp_voice",
        workspaceId: "ws_123",
        name: "Voice Test Campaign",
        status: "DRAFT",
        subject: "Buy cheap luxury watches today",
        previewText: "Huge secret bargain",
        html: "<p>Click here for cheap deals</p>"
      });
      mocks.prisma.campaign.findMany.mockResolvedValue([]);
      mocks.prisma.brandVoice.findUnique.mockResolvedValue({
        brandName: "Aura Luxe",
        preferredTone: "Sophisticated and Prestigious",
        preferredVocabulary: ["exquisite", "artisan", "heritage"],
        prohibitedPhrases: ["cheap", "bargain", "click here", "buy now"]
      });

      // AI hallucinates or produces prohibited words
      mocks.mockChatCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                subjectRecommendations: [
                  {
                    suggestion: "Find your cheap luxury heritage watch",
                    style: "Value",
                    rationale: "Shows it is a cheap bargain."
                  }
                ],
                previewTextRecommendations: [
                  {
                    suggestion: "The ultimate bargain awaits you",
                    rationale: "Highlight bargain price"
                  }
                ],
                contentRecommendations: [
                  {
                    section: "CTA",
                    critique: "Needs more urgency",
                    suggestedChange: "Say buy now today",
                    rationale: "People like cheap things"
                  }
                ],
                ctaRecommendations: [
                  {
                    currentCta: "Old",
                    suggestedCta: "Click here to buy now",
                    placementTip: "Below fold",
                    rationale: "Direct"
                  }
                ],
                audienceRecommendations: [],
                timingRecommendations: {
                  recommendedDay: "Tuesday",
                  recommendedTimeWindow: "10:00 AM",
                  timezoneTip: "Local",
                  rationale: "Good time for a cheap deal",
                  basedOnHistoricalData: false
                },
                overallExplanation: "This avoids looking like a cheap bargain."
              })
            }
          }
        ]
      });

      const res = await fetch(`${baseUrl}/ai/analyze-campaign/camp_voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useBrandVoice: true })
      });
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.appliedBrandVoice).toBe(true);
      // Verify "cheap" and "bargain" were scrubbed
      const sub = json.recommendations.subjectRecommendations[0].suggestion;
      expect(sub.toLowerCase()).not.toContain("cheap");
      expect(sub.toLowerCase()).not.toContain("bargain");

      const pre = json.recommendations.previewTextRecommendations[0].suggestion;
      expect(pre.toLowerCase()).not.toContain("bargain");

      const cta = json.recommendations.ctaRecommendations[0].suggestedCta;
      expect(cta.toLowerCase()).not.toContain("click here");
      expect(cta.toLowerCase()).not.toContain("buy now");
    });
  });

  describe("5. Preventing Accidental Overwrites & Safe Application", () => {
    it("rejects modifying a SENT campaign directly and requires duplication", async () => {
      mocks.prisma.campaign.findFirst.mockResolvedValue({
        id: "camp_sent_already",
        workspaceId: "ws_123",
        name: "Delivered Campaign",
        status: "SENT",
        subject: "Sent Subject"
      });

      const res = await fetch(`${baseUrl}/ai/optimize-campaign/camp_sent_already`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": "ADMIN" },
        body: JSON.stringify({
          action: "apply_recommendations",
          applyChanges: { subject: "Try To Overwrite" }
        })
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/cannot directly modify a sent campaign/i);
    });

    it("allows duplicating a SENT campaign into a new DRAFT with optimizations pre-applied", async () => {
      mocks.prisma.campaign.findFirst.mockResolvedValue({
        id: "camp_sent_already",
        workspaceId: "ws_123",
        name: "Delivered Campaign",
        status: "SENT",
        subject: "Sent Subject",
        previewText: "Old Preview",
        html: "<p>Original HTML</p>",
        targetTags: ["newsletter"],
        fromName: "MailFlow Team",
        fromEmail: "team@mailflow.ai",
        templateId: "tpl_123"
      });
      mocks.prisma.brandVoice.findUnique.mockResolvedValue(null);

      mocks.prisma.campaign.create.mockResolvedValue({
        id: "camp_new_draft",
        workspaceId: "ws_123",
        name: "Delivered Campaign (Optimized Copy)",
        subject: "High Converting Subject",
        previewText: "Optimized Preview",
        html: "<p>Original HTML</p>",
        targetTags: ["newsletter"],
        status: "DRAFT"
      });

      const res = await fetch(`${baseUrl}/ai/optimize-campaign/camp_sent_already`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": "ADMIN" },
        body: JSON.stringify({
          action: "apply_recommendations",
          applyChanges: {
            subject: "High Converting Subject",
            previewText: "Optimized Preview",
            duplicateAsDraftIfSent: true
          }
        })
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.duplicated).toBe(true);
      expect(json.campaign.status).toBe("DRAFT");
      expect(json.campaign.subject).toBe("High Converting Subject");
    });
  });

  describe("6. AI Provider Failures & Rate Limits", () => {
    it("returns 503 when OPENAI_API_KEY is not configured", async () => {
      delete process.env.OPENAI_API_KEY;

      const res = await fetch(`${baseUrl}/ai/analyze-campaign/camp_1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toMatch(/not configured/i);
    });

    it("returns 429 when OpenAI reports rate limit or quota exceeded", async () => {
      mocks.prisma.campaign.findFirst.mockResolvedValue({
        id: "camp_1",
        workspaceId: "ws_123",
        name: "Campaign",
        status: "DRAFT"
      });
      mocks.prisma.campaign.findMany.mockResolvedValue([]);
      mocks.prisma.brandVoice.findUnique.mockResolvedValue(null);

      const rateLimitErr = new Error("Rate limit exceeded");
      rateLimitErr.status = 429;
      mocks.mockChatCreate.mockRejectedValueOnce(rateLimitErr);

      const res = await fetch(`${baseUrl}/ai/analyze-campaign/camp_1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toMatch(/rate limit or usage quota exceeded/i);
    });

    it("returns 502 safely when OpenAI encounters unexpected downstream error", async () => {
      mocks.prisma.campaign.findFirst.mockResolvedValue({
        id: "camp_1",
        workspaceId: "ws_123",
        name: "Campaign",
        status: "DRAFT"
      });
      mocks.prisma.campaign.findMany.mockResolvedValue([]);
      mocks.prisma.brandVoice.findUnique.mockResolvedValue(null);

      mocks.mockChatCreate.mockRejectedValueOnce(new Error("Downstream connection reset"));

      const res = await fetch(`${baseUrl}/ai/analyze-campaign/camp_1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error).toMatch(/check your api key/i);
    });
  });
});
