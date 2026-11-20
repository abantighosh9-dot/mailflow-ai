import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import express from "express";
if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
const { prisma } = vi.hoisted(() => ({ prisma: { contact: Object.fromEntries(["findMany", "findFirst", "findUnique", "create", "createMany", "count", "groupBy", "updateMany", "delete", "deleteMany"].map(k => [k, vi.fn()])) } }));
vi.mock("../netlify/functions/_lib/db.mjs", () => ({ prisma, default: prisma }));
vi.mock("../netlify/functions/_lib/auth.mjs", () => ({
  auth: (req, res, next) => { req.workspace = { id: req.headers["x-test-workspace"] || "workspace-1" }; req.role = req.headers["x-test-role"] || "OWNER"; next(); },
  requireRole: (...roles) => (req, res, next) => roles.includes(req.role) ? next() : res.status(403).json({ error: "Forbidden" }), checkLoginThrottle: vi.fn()
}));
const { default: routes } = await import("../netlify/functions/routes/contacts.mjs");
const app = express(); app.use(express.json()); app.use(routes);
let server, base;
beforeAll(async () => { server = createServer(app); await new Promise(ok => server.listen(0, "127.0.0.1", ok)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(async () => new Promise(ok => server.close(ok)));
beforeEach(() => vi.clearAllMocks());
async function call(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const clone = response.clone(); return { response, body: await response.json().catch(() => null), text: await clone.text() };
}

describe("contacts", () => {
  it("returns 409 for duplicate creation", async () => {
    prisma.contact.create.mockRejectedValue({ code: "P2002" });
    expect((await call("/contacts", { method: "POST", body: JSON.stringify({ email: "a@example.com" }) })).response.status).toBe(409);
  });
  it("returns 400 for invalid contacts", async () => {
    expect((await call("/contacts", { method: "POST", body: JSON.stringify({ email: "bad" }) })).response.status).toBe(400);
  });
  it("reports import counts and duplicates", async () => {
    prisma.contact.createMany.mockImplementation(async ({ data }) => ({ count: data.filter(x => x.email !== "existing@example.com").length }));
    const { body } = await call("/contacts/import", { method: "POST", body: JSON.stringify({ consentConfirmed: true, rows: [{ email: "ok@example.com" }, { email: "existing@example.com" }, { email: "ok@example.com" }, { email: "bad" }, null] }) });
    expect(body).toMatchObject({ imported: 1, duplicates: 2 }); expect(body.invalid).toHaveLength(2);
  });
  it("never updates existing unsubscribed contacts on import", async () => {
    prisma.contact.createMany.mockResolvedValue({ count: 0 });
    await call("/contacts/import", { method: "POST", body: JSON.stringify({ consentConfirmed: true, rows: [{ email: "person@example.com" }] }) });
    expect(prisma.contact.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true })); expect(prisma.contact.updateMany).not.toHaveBeenCalled();
  });
  it.each(["BOUNCED", "COMPLAINED"])("blocks %s to SUBSCRIBED via PATCH", async status => {
    prisma.contact.findFirst.mockResolvedValue({ id: "c1", status });
    const result = await call("/contacts/c1", { method: "PATCH", body: JSON.stringify({ status: "SUBSCRIBED" }) });
    expect(result.response.status).toBe(400); expect(prisma.contact.updateMany).not.toHaveBeenCalled();
  });
  it("returns 404 outside the active workspace", async () => {
    prisma.contact.findFirst.mockResolvedValue(null);
    const result = await call("/contacts/elsewhere", { method: "PATCH", body: JSON.stringify({ firstName: "X" }) });
    expect(result.response.status).toBe(404); expect(prisma.contact.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "elsewhere", workspaceId: "workspace-1" } }));
  });
  it.each(["VIEWER", "ANALYST"])("blocks %s writes", async role => {
    const result = await call("/contacts", { method: "POST", headers: { "x-test-role": role }, body: JSON.stringify({ email: "a@example.com" }) });
    expect(result.response.status).toBe(403);
  });
  it("exports filtered workspace data with CSV escaping and formula protection", async () => {
    prisma.contact.findMany.mockResolvedValue([{ email: "=HYPERLINK(\"x\")", firstName: "A, \"B\"\nC", lastName: null, company: null, status: "SUBSCRIBED", tags: ["vip"], createdAt: new Date(0), source: "manual", consentAt: null }]);
    const result = await call("/contacts/export?q=hyper&status=SUBSCRIBED&tag=vip");
    expect(result.response.headers.get("content-type")).toContain("text/csv"); expect(result.response.headers.get("content-disposition")).toContain("contacts.csv");
    expect(prisma.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: "workspace-1", AND: expect.arrayContaining([{ status: "SUBSCRIBED" }, { tags: { has: "vip" } }]) }) }));
    expect(result.text).toContain("'=HYPERLINK"); expect(result.text).toContain('"A, ""B""\nC"');
  });
});
