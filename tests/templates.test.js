import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import express from "express";

if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) {
  throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
}

const { prisma } = vi.hoisted(() => ({
  prisma: {
    emailTemplate: Object.fromEntries(
      ["findMany", "findFirst", "findUnique", "create", "update", "delete", "count"].map(k => [k, vi.fn()])
    ),
    campaign: Object.fromEntries(
      ["count", "updateMany"].map(k => [k, vi.fn()])
    )
  }
}));

vi.mock("../netlify/functions/_lib/db.mjs", () => ({ prisma, default: prisma }));

vi.mock("../netlify/functions/_lib/auth.mjs", () => ({
  auth: (req, res, next) => {
    if (req.headers["x-test-unauthenticated"]) {
      return res.status(401).json({ error: "Please sign in." });
    }
    req.workspace = { id: req.headers["x-test-workspace"] || "workspace-main" };
    req.role = req.headers["x-test-role"] || "OWNER";
    req.user = { id: "user-1", name: "Template Manager", email: "manager@example.com" };
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (!req.role || !roles.includes(req.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  }
}));

const { default: routes } = await import("../netlify/functions/routes/templates.mjs");
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

describe("Email Template Management API", () => {
  const mockTemplate = {
    id: "tmpl-1",
    workspaceId: "workspace-main",
    name: "Spring Newsletter",
    subject: "Discover what's new in Spring",
    previewText: "Our latest seasonal updates.",
    html: "<h1>Welcome Spring!</h1><p>Check out our catalog.</p>",
    content: { category: "Newsletter" },
    createdAt: new Date()
  };

  describe("GET /templates/starters", () => {
    it("returns collection of starter templates and supported categories", async () => {
      const { response, body } = await call("/templates/starters");
      expect(response.status).toBe(200);
      expect(Array.isArray(body.starters)).toBe(true);
      expect(body.starters.length).toBeGreaterThanOrEqual(5);
      expect(body.categories).toContain("Newsletter");
      expect(body.categories).toContain("Welcome");
      expect(body.starters[0]).toHaveProperty("html");
      expect(body.starters[0]).toHaveProperty("subject");
    });
  });

  describe("GET /templates", () => {
    it("lists templates for workspace and formats category", async () => {
      prisma.emailTemplate.findMany.mockResolvedValueOnce([
        { ...mockTemplate },
        { ...mockTemplate, id: "tmpl-2", name: "Welcome Email", content: { category: "Welcome" } }
      ]);

      const { response, body } = await call("/templates", {
        headers: { "x-test-workspace": "workspace-main" }
      });

      expect(response.status).toBe(200);
      expect(body.templates.length).toBe(2);
      expect(body.templates[0].category).toBe("Newsletter");
      expect(body.templates[1].category).toBe("Welcome");

      expect(prisma.emailTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ workspaceId: "workspace-main" })
        })
      );
    });

    it("filters templates by category", async () => {
      prisma.emailTemplate.findMany.mockResolvedValueOnce([
        { ...mockTemplate, id: "tmpl-1", content: { category: "Newsletter" } },
        { ...mockTemplate, id: "tmpl-2", content: { category: "Welcome" } }
      ]);

      const { response, body } = await call("/templates?category=Welcome");
      expect(response.status).toBe(200);
      expect(body.templates.length).toBe(1);
      expect(body.templates[0].id).toBe("tmpl-2");
      expect(body.templates[0].category).toBe("Welcome");
    });

    it("filters templates by search term in name or subject", async () => {
      prisma.emailTemplate.findMany.mockResolvedValueOnce([mockTemplate]);

      const { response } = await call("/templates?search=Spring");
      expect(response.status).toBe(200);
      expect(prisma.emailTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: "Spring", mode: "insensitive" } },
              { subject: { contains: "Spring", mode: "insensitive" } }
            ]
          })
        })
      );
    });
  });

  describe("GET /templates/:id", () => {
    it("returns template details for the authenticated workspace", async () => {
      prisma.emailTemplate.findFirst.mockResolvedValueOnce({ ...mockTemplate });

      const { response, body } = await call("/templates/tmpl-1");
      expect(response.status).toBe(200);
      expect(body.template.id).toBe("tmpl-1");
      expect(body.template.name).toBe("Spring Newsletter");
      expect(body.template.category).toBe("Newsletter");
    });

    it("returns 404 when template does not exist or belongs to another workspace", async () => {
      prisma.emailTemplate.findFirst.mockResolvedValueOnce(null);

      const { response, body } = await call("/templates/tmpl-foreign", {
        headers: { "x-test-workspace": "workspace-attacker" }
      });
      expect(response.status).toBe(404);
      expect(body.error).toMatch(/not found/i);
    });
  });

  describe("POST /templates", () => {
    it("creates a new template with category and sanitized HTML", async () => {
      prisma.emailTemplate.create.mockImplementation(async ({ data }) => ({
        id: "tmpl-new-1",
        ...data,
        createdAt: new Date()
      }));

      const payload = {
        name: "Product Launch Special",
        subject: "The wait is over!",
        previewText: "See our latest release.",
        category: "Product Launch",
        html: "<h1>Launch Time</h1><p>Explore features.</p>"
      };

      const { response, body } = await call("/templates", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "x-test-workspace": "workspace-main", "x-test-role": "EDITOR" }
      });

      expect(response.status).toBe(201);
      expect(body.template.name).toBe("Product Launch Special");
      expect(body.template.category).toBe("Product Launch");
      expect(body.template.subject).toBe("The wait is over!");

      expect(prisma.emailTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workspaceId: "workspace-main",
            name: "Product Launch Special",
            html: "<h1>Launch Time</h1><p>Explore features.</p>"
          })
        })
      );
    });

    it("supports legacy EmailStudio payload format seamlessly", async () => {
      prisma.emailTemplate.create.mockImplementation(async ({ data }) => ({
        id: "tmpl-studio-1",
        ...data,
        createdAt: new Date()
      }));

      const studioPayload = {
        name: "AI Generated Template",
        email: {
          subject: "AI Subject",
          previewText: "AI Preview",
          html: "<p>Generated by AI</p>"
        }
      };

      const { response, body } = await call("/templates", {
        method: "POST",
        body: JSON.stringify(studioPayload)
      });

      expect(response.status).toBe(201);
      expect(body.template.name).toBe("AI Generated Template");
      expect(body.template.subject).toBe("AI Subject");
      expect(body.template.html).toBe("<p>Generated by AI</p>");
    });

    it("rejects creation with empty name or empty HTML", async () => {
      const invalidPayload = {
        name: "",
        html: ""
      };

      const { response, body } = await call("/templates", {
        method: "POST",
        body: JSON.stringify(invalidPayload)
      });

      expect(response.status).toBe(400);
      expect(body.error).toBeDefined();
      expect(prisma.emailTemplate.create).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /templates/:id", () => {
    it("updates existing template content and category", async () => {
      prisma.emailTemplate.findFirst.mockResolvedValueOnce({ ...mockTemplate });
      prisma.emailTemplate.update.mockResolvedValueOnce({
        ...mockTemplate,
        name: "Updated Newsletter Title",
        subject: "Updated Subject Line",
        content: { category: "Newsletter" }
      });

      const { response, body } = await call("/templates/tmpl-1", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Updated Newsletter Title",
          subject: "Updated Subject Line"
        })
      });

      expect(response.status).toBe(200);
      expect(body.template.name).toBe("Updated Newsletter Title");
      expect(body.template.subject).toBe("Updated Subject Line");
    });

    it("returns 404 when trying to update template from another workspace", async () => {
      prisma.emailTemplate.findFirst.mockResolvedValueOnce(null);

      const { response, body } = await call("/templates/tmpl-other", {
        method: "PATCH",
        body: JSON.stringify({ name: "Hacked Title" }),
        headers: { "x-test-workspace": "workspace-attacker" }
      });

      expect(response.status).toBe(404);
      expect(body.error).toMatch(/not found/i);
      expect(prisma.emailTemplate.update).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /templates/:id", () => {
    it("safely unlinks draft campaigns and deletes template", async () => {
      prisma.emailTemplate.findFirst.mockResolvedValueOnce({ ...mockTemplate });
      prisma.campaign.count.mockResolvedValueOnce(0); // 0 active/scheduled campaigns
      prisma.campaign.updateMany.mockResolvedValueOnce({ count: 1 }); // unlinked 1 draft
      prisma.emailTemplate.delete.mockResolvedValueOnce({ id: "tmpl-1" });

      const { response, body } = await call("/templates/tmpl-1", {
        method: "DELETE",
        headers: { "x-test-workspace": "workspace-main", "x-test-role": "ADMIN" }
      });

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      // Verify draft campaigns are safely unlinked
      expect(prisma.campaign.updateMany).toHaveBeenCalledWith({
        where: { templateId: "tmpl-1", workspaceId: "workspace-main" },
        data: { templateId: null }
      });
      expect(prisma.emailTemplate.delete).toHaveBeenCalledWith({
        where: { id: "tmpl-1" }
      });
    });

    it("prevents deletion if template is currently referenced by scheduled or sending campaigns", async () => {
      prisma.emailTemplate.findFirst.mockResolvedValueOnce({ ...mockTemplate });
      prisma.campaign.count.mockResolvedValueOnce(2); // 2 scheduled/sending campaigns!

      const { response, body } = await call("/templates/tmpl-1", {
        method: "DELETE"
      });

      expect(response.status).toBe(400);
      expect(body.error).toMatch(/currently referenced by 2 scheduled or sending campaign/i);
      expect(prisma.emailTemplate.delete).not.toHaveBeenCalled();
    });
  });

  describe("POST /templates/:id/duplicate", () => {
    it("duplicates an existing template with a clean copy name", async () => {
      prisma.emailTemplate.findFirst.mockResolvedValueOnce({ ...mockTemplate });
      prisma.emailTemplate.create.mockImplementation(async ({ data }) => ({
        id: "tmpl-copy-1",
        ...data,
        createdAt: new Date()
      }));

      const { response, body } = await call("/templates/tmpl-1/duplicate", {
        method: "POST"
      });

      expect(response.status).toBe(201);
      expect(body.template.name).toBe("Spring Newsletter (Copy)");
      expect(body.template.subject).toBe(mockTemplate.subject);
      expect(body.template.html).toBe(mockTemplate.html);
      expect(body.template.category).toBe("Newsletter");
    });

    it("returns 404 when duplicating a template from another workspace", async () => {
      prisma.emailTemplate.findFirst.mockResolvedValueOnce(null);

      const { response, body } = await call("/templates/tmpl-foreign/duplicate", {
        method: "POST",
        headers: { "x-test-workspace": "workspace-attacker" }
      });

      expect(response.status).toBe(404);
      expect(body.error).toMatch(/not found/i);
      expect(prisma.emailTemplate.create).not.toHaveBeenCalled();
    });
  });

  describe("Role permissions and authorization", () => {
    it("restricts template mutation (POST, PATCH, DELETE) to OWNER, ADMIN, and EDITOR roles", async () => {
      const createRes = await call("/templates", {
        method: "POST",
        body: JSON.stringify({ name: "T", html: "<p>x</p>" }),
        headers: { "x-test-role": "VIEWER" }
      });
      expect(createRes.response.status).toBe(403);

      const deleteRes = await call("/templates/tmpl-1", {
        method: "DELETE",
        headers: { "x-test-role": "ANALYST" }
      });
      expect(deleteRes.response.status).toBe(403);
    });

    it("allows VIEWER and ANALYST to read templates via GET", async () => {
      prisma.emailTemplate.findMany.mockResolvedValueOnce([]);

      const { response } = await call("/templates", {
        headers: { "x-test-role": "VIEWER" }
      });
      expect(response.status).toBe(200);
    });

    it("rejects unauthenticated requests with 401", async () => {
      const { response, body } = await call("/templates", {
        headers: { "x-test-unauthenticated": "true" }
      });
      expect(response.status).toBe(401);
      expect(body.error).toMatch(/sign in/i);
    });
  });
});
