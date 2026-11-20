import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import express from "express";

if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
const { prisma } = vi.hoisted(() => ({ prisma: { contact: { findFirst: vi.fn(), updateMany: vi.fn() } } }));
vi.mock("../netlify/functions/_lib/db.mjs", () => ({ prisma, default: prisma }));
const { default: route } = await import("../netlify/functions/routes/unsubscribe.mjs");
const { signUnsubscribeToken } = await import("../netlify/functions/_lib/unsub.mjs");
const app = express(); app.use(express.json()); app.use(route);
let server, base;
beforeAll(async () => { process.env.UNSUBSCRIBE_SECRET = "vitest-only-secret-long-enough"; server = createServer(app); await new Promise(ok => server.listen(0, "127.0.0.1", ok)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(async () => new Promise(ok => server.close(ok)));
beforeEach(() => vi.clearAllMocks());
const token = () => signUnsubscribeToken({ contactId: "contact-1", workspaceId: "workspace-1" });
async function postOrGet(path, method = "GET") { return fetch(`${base}${path}`, { method }); }

describe("public unsubscribe", () => {
  it("GET renders confirmation without changing database state", async () => {
    prisma.contact.findFirst.mockResolvedValue({ id: "contact-1", email: "person@example.com" });
    const response = await postOrGet(`/unsubscribe?token=${encodeURIComponent(token())}`); const html = await response.text();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store"); expect(html).toContain("Confirm unsubscribe");
    expect(prisma.contact.updateMany).not.toHaveBeenCalled();
  });
  it("POST changes a subscribed contact", async () => {
    prisma.contact.findFirst.mockResolvedValue({ id: "contact-1", status: "SUBSCRIBED" }); prisma.contact.updateMany.mockResolvedValue({ count: 1 });
    const response = await postOrGet(`/unsubscribe?token=${encodeURIComponent(token())}`, "POST");
    expect(response.status).toBe(200); expect(prisma.contact.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "contact-1", workspaceId: "workspace-1", status: "SUBSCRIBED" }, data: expect.objectContaining({ status: "UNSUBSCRIBED", unsubscribedAt: expect.any(Date) }) }));
  });
  it("rejects invalid tokens", async () => {
    const response = await postOrGet("/unsubscribe?token=not-valid");
    expect(response.status).toBe(400); expect(prisma.contact.findFirst).not.toHaveBeenCalled();
  });
  it("handles repeated unsubscribe requests idempotently", async () => {
    prisma.contact.findFirst.mockResolvedValue({ id: "contact-1", status: "UNSUBSCRIBED" }); const url = `/unsubscribe?token=${encodeURIComponent(token())}`;
    const first = await postOrGet(url, "POST"), second = await postOrGet(url, "POST");
    expect(first.status).toBe(200); expect(second.status).toBe(200); expect(prisma.contact.updateMany).not.toHaveBeenCalled();
  });
});
