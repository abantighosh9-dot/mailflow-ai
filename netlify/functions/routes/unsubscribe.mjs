import express from "express";
import { prisma } from "../_lib/db.mjs";
import { verifyUnsubscribeToken } from "../_lib/unsub.mjs";

const router = express.Router();
const securityHeaders = (_req, res, next) => {
  res.set({
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  next();
};
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tokenFor = req => req.query.token || req.body?.token;
const page = (title, content) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><body style="font:16px system-ui;max-width:560px;margin:4rem auto;padding:1rem"><h1>${escapeHtml(title)}</h1><p>${content}</p></body></html>`;

router.get("/unsubscribe", securityHeaders, async (req, res) => {
  const token = verifyUnsubscribeToken(tokenFor(req));
  if (!token) return res.status(400).type("html").send(page("Link expired", "This unsubscribe link is invalid or has expired."));
  try {
    const contact = await prisma.contact.findFirst({ where: { id: token.contactId, workspaceId: token.workspaceId }, select: { id: true, email: true } });
    if (!contact) return res.status(404).type("html").send(page("Contact not found", "This unsubscribe link is no longer valid."));
    const email = escapeHtml(contact.email);
    return res.type("html").send(page("Confirm unsubscribe", `Confirm that you want to unsubscribe <strong>${email}</strong>.<form method="post" action="/api/unsubscribe?token=${encodeURIComponent(String(tokenFor(req))) }"><button style="margin-top:1rem;padding:.7rem 1rem" type="submit">Unsubscribe</button></form>`));
  } catch (error) {
    console.error("GET /unsubscribe failed", error);
    return res.status(500).type("html").send(page("Unable to process request", "Please try again later."));
  }
});

router.post("/unsubscribe", securityHeaders, async (req, res) => {
  const token = verifyUnsubscribeToken(tokenFor(req));
  if (!token) return res.status(400).type("html").send(page("Link expired", "This unsubscribe link is invalid or has expired."));
  try {
    const contact = await prisma.contact.findFirst({ where: { id: token.contactId, workspaceId: token.workspaceId }, select: { id: true, status: true } });
    if (!contact) return res.status(404).type("html").send(page("Contact not found", "This unsubscribe link is no longer valid."));
    if (contact.status === "SUBSCRIBED") {
      await prisma.contact.updateMany({ where: { id: token.contactId, workspaceId: token.workspaceId, status: "SUBSCRIBED" }, data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() } });
    }
    return res.type("html").send(page("Unsubscribed", "Your email preferences have been updated."));
  } catch (error) {
    console.error("POST /unsubscribe failed", error);
    return res.status(500).type("html").send(page("Unable to process request", "Please try again later."));
  }
});

export default router;
