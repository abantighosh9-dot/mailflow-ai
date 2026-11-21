import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import express from "express";

if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) {
  throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
}

// 1. Mock DNS module for predictable verifier testing
const dnsMock = vi.hoisted(() => ({
  resolveTxt: vi.fn(),
  resolveCname: vi.fn()
}));

vi.mock("node:dns/promises", () => ({
  default: dnsMock,
  resolveTxt: dnsMock.resolveTxt,
  resolveCname: dnsMock.resolveCname
}));

// 2. Mock Prisma Client
const { prismaMock } = vi.hoisted(() => {
  const p = {
    sendingDomain: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    domainDnsRecord: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn()
    },
    deliverabilityCheck: {
      create: vi.fn()
    },
    domainHealthHistory: {
      create: vi.fn()
    },
    campaign: {
      findMany: vi.fn(),
      findFirst: vi.fn()
    },
    campaignRecipient: {
      findMany: vi.fn()
    },
    $transaction: vi.fn(async cb => cb(p))
  };
  return { prismaMock: p };
});

vi.mock("../netlify/functions/_lib/db.mjs", () => ({
  prisma: prismaMock,
  default: prismaMock
}));

// 3. Mock Authentication and Role RBAC
vi.mock("../netlify/functions/_lib/auth.mjs", () => ({
  auth: (req, res, next) => {
    if (req.headers["x-test-unauthenticated"]) {
      return res.status(401).json({ error: "Please sign in." });
    }
    const role = req.headers["x-test-role"] || "OWNER";
    const workspaceId = req.headers["x-test-workspace"] || "ws_test_123";
    req.workspace = { id: workspaceId, role };
    req.role = role;
    req.user = { id: "user_test_1", email: "sender@example.com", workspaceId };
    next();
  },
  requireRole: (...allowedRoles) => (req, res, next) => {
    if (!req.role || !allowedRoles.includes(req.role)) {
      return res.status(403).json({ error: "You do not have permission to perform this action." });
    }
    next();
  }
}));

// Import modules to test
const {
  validateSafeDomain,
  generateDefaultDnsRecords,
  verifySingleRecord,
  calculateDomainHealthScore,
  getRegistrarInstructions
} = await import("../netlify/functions/_lib/dns-verifier.mjs");

const { analyzeEmailSpamScore } = await import("../netlify/functions/_lib/spam-analyzer.mjs");
const { default: deliverabilityRoutes } = await import("../netlify/functions/routes/deliverability.mjs");

const app = express();
app.use(express.json());
app.use(deliverabilityRoutes);

let server, baseUrl;

beforeAll(async () => {
  server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ==========================================
// UNIT TESTS: Domain Validator & SSRF Guard
// ==========================================
describe("SSRF Protection & Safe Domain Validator", () => {
  it("approves valid standard domain names", () => {
    const validDomains = [
      "example.com",
      "mail.mycompany.org",
      "newsletters.co.uk",
      "app-sender.marketing.io"
    ];
    for (const d of validDomains) {
      const res = validateSafeDomain(d);
      expect(res.valid).toBe(true);
      expect(res.domain).toBe(d.toLowerCase());
    }
  });

  it("rejects loopback and localhost hostnames", () => {
    expect(validateSafeDomain("localhost").valid).toBe(false);
    expect(validateSafeDomain("local").valid).toBe(false);
    expect(validateSafeDomain("myhost.localhost").valid).toBe(false);
    expect(validateSafeDomain("127.0.0.1").valid).toBe(false);
    expect(validateSafeDomain("::1").valid).toBe(false);
  });

  it("rejects private/internal domain zones and IP addresses", () => {
    expect(validateSafeDomain("server.internal").valid).toBe(false);
    expect(validateSafeDomain("gateway.lan").valid).toBe(false);
    expect(validateSafeDomain("router.local").valid).toBe(false);
    expect(validateSafeDomain("10.0.0.1").valid).toBe(false);
    expect(validateSafeDomain("192.168.1.1").valid).toBe(false);
  });

  it("rejects protocol schemes and URL paths", () => {
    expect(validateSafeDomain("https://example.com").valid).toBe(false);
    expect(validateSafeDomain("http://sender.org/path").valid).toBe(false);
    expect(validateSafeDomain("example.com/api").valid).toBe(false);
  });
});

// ==========================================
// UNIT TESTS: DNS Verifier Engine
// ==========================================
describe("DNS Verifier Engine", () => {
  it("generates the 4 required standard DNS records", () => {
    const records = generateDefaultDnsRecords("news.acme.com", {
      dkimSelector: "mailo",
      trackingSubdomain: "track"
    });
    expect(records).toHaveLength(4);
    const purposes = records.map(r => r.purpose);
    expect(purposes).toEqual(["SPF", "DKIM", "DMARC", "TRACKING"]);

    const spf = records.find(r => r.purpose === "SPF");
    expect(spf.expectedValue).toContain("include:spf.brevo.com");

    const dkim = records.find(r => r.purpose === "DKIM");
    expect(dkim.name).toBe("mailo._domainkey");

    const dmarc = records.find(r => r.purpose === "DMARC");
    expect(dmarc.name).toBe("_dmarc");
    expect(dmarc.expectedValue).toContain("v=DMARC1");
  });

  it("verifies SPF record successfully when include:spf.brevo.com exists", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=spf1 include:spf.brevo.com ~all"]
    ]);

    const record = {
      id: "rec_spf_1",
      purpose: "SPF",
      recordType: "TXT",
      name: "@",
      expectedValue: "v=spf1 include:spf.brevo.com ~all"
    };

    const res = await verifySingleRecord(record, "acme.com");
    expect(res.status).toBe("VERIFIED");
    expect(res.actualValue).toContain("include:spf.brevo.com");
  });

  it("marks SPF as INVALID when SPF exists but lacks Brevo include", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=spf1 include:_spf.google.com ~all"]
    ]);

    const record = {
      id: "rec_spf_2",
      purpose: "SPF",
      recordType: "TXT",
      name: "@",
      expectedValue: "v=spf1 include:spf.brevo.com ~all"
    };

    const res = await verifySingleRecord(record, "acme.com");
    expect(res.status).toBe("INVALID");
    expect(res.errorMessage).toContain("include:spf.brevo.com");
  });

  it("marks DKIM as VERIFIED when public key p= is found", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDeMkWegAA8/zsYhk7smW..."]
    ]);

    const record = {
      id: "rec_dkim_1",
      purpose: "DKIM",
      recordType: "TXT",
      name: "mailo._domainkey",
      expectedValue: "k=rsa; p=MIGf..."
    };

    const res = await verifySingleRecord(record, "acme.com");
    expect(res.status).toBe("VERIFIED");
  });

  it("marks DMARC as VERIFIED when valid policy exists", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=DMARC1; p=none; sp=none; rua=mailto:dmarc@acme.com"]
    ]);

    const record = {
      id: "rec_dmarc_1",
      purpose: "DMARC",
      recordType: "TXT",
      name: "_dmarc",
      expectedValue: "v=DMARC1; p=none;"
    };

    const res = await verifySingleRecord(record, "acme.com");
    expect(res.status).toBe("VERIFIED");
  });

  it("verifies CNAME tracking record matching expected host", async () => {
    dnsMock.resolveCname.mockResolvedValueOnce(["track.mailflow.app."]);

    const record = {
      id: "rec_cname_1",
      purpose: "TRACKING",
      recordType: "CNAME",
      name: "track",
      expectedValue: "track.mailflow.app"
    };

    const res = await verifySingleRecord(record, "acme.com");
    expect(res.status).toBe("VERIFIED");
  });

  it("calculates domain health score accurately with deductions", () => {
    // All verified, no bounce penalty -> 100
    const perfectScore = calculateDomainHealthScore({
      spfStatus: "VERIFIED",
      dkimStatus: "VERIFIED",
      dmarcStatus: "VERIFIED",
      customTrackingStatus: "VERIFIED",
      bounceRate: 0.5,
      complaintRate: 0.01
    });
    expect(perfectScore).toBe(100);

    // Pending records -> 50
    const pendingScore = calculateDomainHealthScore({
      spfStatus: "PENDING",
      dkimStatus: "PENDING",
      dmarcStatus: "PENDING"
    });
    expect(pendingScore).toBe(50);

    // High bounce rate (> 5%) and complaint rate (> 0.1%) triggers heavy penalty
    const penalScore = calculateDomainHealthScore({
      spfStatus: "VERIFIED",
      dkimStatus: "VERIFIED",
      dmarcStatus: "VERIFIED",
      bounceRate: 6.5,
      complaintRate: 0.25
    });
    expect(penalScore).toBeLessThan(60);
  });
});

// ==========================================
// UNIT TESTS: Pre-Send Spam Score Analyzer
// ==========================================
describe("Pre-Send Spam Score Analyzer", () => {
  it("scores clean professional emails with high score (LOW risk)", () => {
    const analysis = analyzeEmailSpamScore({
      subject: "Important update regarding your account security",
      fromEmail: "security@company.com",
      html: `<div>
        <p>Hello valued customer,</p>
        <p>Please review our latest security guidelines below.</p>
        <p><a href="{{unsubscribe_url}}">Unsubscribe</a> | 123 Business Way, Suite 100</p>
      </div>`
    });

    expect(analysis.score).toBeGreaterThanOrEqual(80);
    expect(analysis.riskLevel).toBe("LOW");
    expect(analysis.issues.some(i => i.severity === "CRITICAL")).toBe(false);
  });

  it("detects missing unsubscribe link as CRITICAL issue", () => {
    const analysis = analyzeEmailSpamScore({
      subject: "Monthly newsletter",
      fromEmail: "news@company.com",
      html: "<div><p>Check out our latest news.</p></div>"
    });

    const unSubIssue = analysis.issues.find(i => i.rule === "MISSING_UNSUBSCRIBE");
    expect(unSubIssue).toBeDefined();
    expect(unSubIssue.severity).toBe("CRITICAL");
    expect(analysis.score).toBeLessThanOrEqual(75);
  });

  it("detects public URL shorteners (bit.ly) as CRITICAL issue", () => {
    const analysis = analyzeEmailSpamScore({
      subject: "Quick link for you",
      fromEmail: "team@company.com",
      html: `<p>Click here: <a href="https://bit.ly/surprise-gift">Claim</a></p><a href="{{unsubscribe_url}}">Unsubscribe</a>`
    });

    const urlIssue = analysis.issues.find(i => i.rule === "SUSPICIOUS_SHORTENED_URLS");
    expect(urlIssue).toBeDefined();
    expect(urlIssue.severity).toBe("CRITICAL");
  });

  it("penalizes spam trigger words, ALL CAPS subject, and exclamation marks", () => {
    const analysis = analyzeEmailSpamScore({
      subject: "WINNER! 100% FREE CASH BONUS ACT NOW!!!!",
      fromEmail: "freebies@gmail.com",
      html: `<div>
        <p>CONGRATULATIONS! You have been selected to make money fast with zero risk!</p>
        <p><a href="http://tinyurl.com/fastcash">CLICK HERE NOW</a></p>
      </div>`
    });

    expect(analysis.score).toBeLessThan(50);
    expect(analysis.riskLevel).toBe("HIGH");
    expect(analysis.issues.length).toBeGreaterThanOrEqual(4);
  });
});

// ==========================================
// INTEGRATION TESTS: Deliverability API Routes
// ==========================================
describe("Deliverability API Endpoints", () => {
  it("GET /deliverability/overview aggregates delivery counters and alert thresholds", async () => {
    prismaMock.sendingDomain.findMany.mockResolvedValueOnce([
      { id: "dom_1", domain: "company.com", status: "VERIFIED", healthScore: 95, dnsRecords: [] }
    ]);

    prismaMock.campaign.findMany.mockResolvedValueOnce([
      {
        sendSucceeded: 1000,
        deliveredCount: 980,
        bouncedCount: 15,
        complainedCount: 0,
        openedCount: 450,
        clickedCount: 120
      }
    ]);

    prismaMock.campaignRecipient.findMany.mockResolvedValueOnce([]);

    const res = await fetch(`${baseUrl}/deliverability/overview`, {
      headers: { "x-test-workspace": "ws_123" }
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.healthScore).toBe(95);
    expect(data.metrics.totalSent).toBe(1000);
    expect(data.metrics.deliveryRate).toBe(98);
    expect(data.metrics.bounceRate).toBe(1.5);
    expect(data.domainsSummary.verified).toBe(1);
    expect(data.alerts.highBounceRate).toBe(false);
  });

  it("POST /deliverability/domains creates domain with standard DNS records", async () => {
    prismaMock.sendingDomain.findUnique.mockResolvedValueOnce(null); // No duplicate
    prismaMock.sendingDomain.create.mockResolvedValueOnce({
      id: "dom_new_1",
      workspaceId: "ws_123",
      domain: "sender.mybrand.com",
      status: "PENDING"
    });
    prismaMock.domainDnsRecord.create.mockResolvedValue({});
    prismaMock.sendingDomain.findUnique.mockResolvedValueOnce({
      id: "dom_new_1",
      domain: "sender.mybrand.com",
      status: "PENDING",
      dnsRecords: [
        { purpose: "SPF", recordType: "TXT", expectedValue: "v=spf1 include:spf.brevo.com ~all" }
      ]
    });

    const res = await fetch(`${baseUrl}/deliverability/domains`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-workspace": "ws_123",
        "x-test-role": "ADMIN"
      },
      body: JSON.stringify({
        domain: "sender.mybrand.com"
      })
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.domain.domain).toBe("sender.mybrand.com");
    expect(body.instructions.steps.length).toBeGreaterThan(0);
  });

  it("POST /deliverability/domains rejects SSRF / localhost attempts", async () => {
    const res = await fetch(`${baseUrl}/deliverability/domains`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-workspace": "ws_123",
        "x-test-role": "ADMIN"
      },
      body: JSON.stringify({
        domain: "localhost"
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("domain");
  });

  it("POST /deliverability/domains enforces RBAC (403 for VIEWER)", async () => {
    const res = await fetch(`${baseUrl}/deliverability/domains`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-workspace": "ws_123",
        "x-test-role": "VIEWER"
      },
      body: JSON.stringify({
        domain: "valid.company.com"
      })
    });

    expect(res.status).toBe(403);
  });

  it("POST /deliverability/domains/:id/verify triggers live check and updates status", async () => {
    prismaMock.sendingDomain.findFirst.mockResolvedValueOnce({
      id: "dom_1",
      domain: "verified.com",
      workspaceId: "ws_123",
      dnsRecords: [
        {
          id: "rec_1",
          purpose: "SPF",
          recordType: "TXT",
          name: "@",
          expectedValue: "v=spf1 include:spf.brevo.com ~all"
        },
        {
          id: "rec_2",
          purpose: "DKIM",
          recordType: "TXT",
          name: "mailo._domainkey",
          expectedValue: "k=rsa; p=MIGf..."
        }
      ]
    });

    dnsMock.resolveTxt
      .mockResolvedValueOnce([["v=spf1 include:spf.brevo.com ~all"]]) // SPF
      .mockResolvedValueOnce([["k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBg..."]]); // DKIM

    prismaMock.domainDnsRecord.update.mockResolvedValue({});
    prismaMock.sendingDomain.update.mockResolvedValueOnce({
      id: "dom_1",
      domain: "verified.com",
      status: "VERIFIED",
      healthScore: 85,
      dnsRecords: []
    });
    prismaMock.domainHealthHistory.create.mockResolvedValue({});

    const res = await fetch(`${baseUrl}/deliverability/domains/dom_1/verify`, {
      method: "POST",
      headers: {
        "x-test-workspace": "ws_123",
        "x-test-role": "EDITOR"
      }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain.status).toBe("VERIFIED");
  });

  it("DELETE /deliverability/domains/:id allows OWNER/ADMIN but forbids VIEWER/EDITOR", async () => {
    // 1. Forbidden for VIEWER
    const resForbidden = await fetch(`${baseUrl}/deliverability/domains/dom_1`, {
      method: "DELETE",
      headers: { "x-test-workspace": "ws_123", "x-test-role": "VIEWER" }
    });
    expect(resForbidden.status).toBe(403);

    // 2. Allowed for OWNER
    prismaMock.sendingDomain.findFirst.mockResolvedValueOnce({
      id: "dom_1",
      domain: "delete-me.com",
      workspaceId: "ws_123"
    });
    prismaMock.sendingDomain.delete.mockResolvedValueOnce({ id: "dom_1" });

    const resAllowed = await fetch(`${baseUrl}/deliverability/domains/dom_1`, {
      method: "DELETE",
      headers: { "x-test-workspace": "ws_123", "x-test-role": "OWNER" }
    });
    expect(resAllowed.status).toBe(200);
  });

  it("POST /deliverability/analyze-spam returns real-time deliverability score", async () => {
    const res = await fetch(`${baseUrl}/deliverability/analyze-spam`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-workspace": "ws_123"
      },
      body: JSON.stringify({
        subject: "Exclusive Member Update",
        fromEmail: "team@acme.com",
        html: "<p>Welcome back! Check our updates. <a href='{{unsubscribe_url}}'>Unsubscribe</a></p>"
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.score).toBeGreaterThanOrEqual(80);
    expect(body.riskLevel).toBe("LOW");
    expect(Array.isArray(body.suggestions)).toBe(true);
  });
});
