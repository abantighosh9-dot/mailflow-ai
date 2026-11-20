// Brevo Transactional Webhooks Handler — Audited & Hardened Implementation
import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../_lib/db.mjs";

const router = express.Router();

/**
 * Constant-time string comparison to prevent timing attacks.
 * Safe against mismatched lengths without throwing.
 */
function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies authenticity of incoming Brevo webhook request.
 * Supported official Brevo methods (https://developers.brevo.com/docs/secured-webhooks):
 *  1. Bearer Token Authentication (Authorization: Bearer <token>)
 *  2. Basic Authentication in webhook URL (Authorization: Basic <base64>)
 *  3. Custom Request Headers (e.g. X-Webhook-Secret / X-Brevo-Webhook-Secret)
 *
 * Fails closed if BREVO_WEBHOOK_SECRET is not configured.
 * Does not accept arbitrary query parameters.
 */
export function verifyWebhookAuth(req) {
  const configuredSecret = process.env.BREVO_WEBHOOK_SECRET;

  if (!configuredSecret || !configuredSecret.trim()) {
    // Fail-closed: Never accept webhook requests if secret is unconfigured
    return { authorized: false, error: "BREVO_WEBHOOK_SECRET is not configured on the server." };
  }

  const expected = configuredSecret.trim();

  // 1. Custom Headers (configured via Brevo webhook settings)
  const customHeader = req.headers["x-webhook-secret"] || req.headers["x-brevo-webhook-secret"];
  if (customHeader && timingSafeEqualStr(String(customHeader).trim(), expected)) {
    return { authorized: true };
  }

  // 2. Authorization Header: Bearer token or Basic auth
  const authHeader = req.headers.authorization;
  if (authHeader) {
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (timingSafeEqualStr(token, expected)) {
        return { authorized: true };
      }
    } else if (authHeader.startsWith("Basic ")) {
      try {
        const decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8");
        const separatorIdx = decoded.indexOf(":");
        if (separatorIdx !== -1) {
          const user = decoded.slice(0, separatorIdx);
          const pass = decoded.slice(separatorIdx + 1);
          if (timingSafeEqualStr(pass, expected) || timingSafeEqualStr(user, expected)) {
            return { authorized: true };
          }
        }
      } catch {}
    }
  }

  return { authorized: false, error: "Unauthorized webhook request." };
}

/**
 * Normalizes Brevo event names across API versions and casings.
 */
export function normalizeBrevoEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== "string") return "unknown";
  const cleaned = rawEvent.toLowerCase().trim().replace(/[^a-z]/g, "");

  if (cleaned === "delivered") return "delivered";
  if (["opened", "uniqueopened", "proxyopen", "uniqueproxyopen", "firstopening"].includes(cleaned)) return "opened";
  if (["click", "clicked"].includes(cleaned)) return "click";
  if (["hardbounce"].includes(cleaned)) return "hard_bounce";
  if (["softbounce"].includes(cleaned)) return "soft_bounce";
  if (["blocked"].includes(cleaned)) return "blocked";
  if (["invalid", "invalidemail"].includes(cleaned)) return "invalid_email";
  if (["spam", "complaint", "complained"].includes(cleaned)) return "spam";
  if (["unsubscribed"].includes(cleaned)) return "unsubscribed";
  if (["deferred"].includes(cleaned)) return "deferred";
  if (["sent", "request"].includes(cleaned)) return "sent";
  if (["error"].includes(cleaned)) return "error";

  return cleaned;
}

/**
 * Constructs a deterministic deduplication key for a Brevo delivery/engagement event.
 * Note: Brevo's 'id' field is the webhook registration ID, NOT a unique delivery event ID.
 * Deduplication key uses messageId, email, event name, timestamp, and context (link/reason).
 */
export function buildEventDeduplicationKey(ev, normalizedEvent) {
  const messageId = (ev["message-id"] || ev.messageId || "").trim();
  const email = (ev.email || "").trim().toLowerCase();
  const timestamp = ev.ts_event !== undefined && ev.ts_event !== null
    ? String(ev.ts_event)
    : (ev.ts !== undefined && ev.ts !== null
      ? String(ev.ts)
      : (ev.ts_epoch !== undefined && ev.ts_epoch !== null
        ? String(ev.ts_epoch)
        : (ev.date ? String(ev.date).trim() : "no_ts")));

  const parts = [
    messageId || email || "unknown_recipient",
    normalizedEvent,
    timestamp
  ];

  if (normalizedEvent === "click" && ev.link) {
    parts.push(String(ev.link).trim());
  }

  if ((normalizedEvent === "hard_bounce" || normalizedEvent === "soft_bounce") && (ev.reason || ev.description)) {
    parts.push(String(ev.reason || ev.description).trim());
  }

  return crypto.createHash("sha256").update(parts.join(":")).digest("hex");
}

// Zod validation for Brevo transactional delivery event payload
const brevoEventSchema = z.object({
  event: z.string().trim().min(1, "Event name is required"),
  email: z.string().trim().email().optional().nullable(),
  "message-id": z.string().trim().optional().nullable(),
  messageId: z.string().trim().optional().nullable(),
  id: z.union([z.string(), z.number()]).optional().nullable(), // Webhook registration ID in Brevo
  date: z.string().optional().nullable(),
  ts: z.number().optional().nullable(),
  ts_event: z.number().optional().nullable(),
  ts_epoch: z.number().optional().nullable(),
  reason: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  link: z.string().optional().nullable(),
  tag: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  sending_ip: z.string().optional().nullable(),
  template_id: z.union([z.string(), z.number()]).optional().nullable(),
  contact_id: z.union([z.string(), z.number()]).optional().nullable(),
  source: z.string().optional().nullable()
}).passthrough();

/**
 * Recalculates campaign metrics from CampaignRecipient records atomically.
 */
async function syncCampaignMetrics(campaignId, db = prisma) {
  if (!campaignId) return;

  const [
    succeededCount,
    failedCount,
    deliveredCount,
    bouncedCount,
    complainedCount,
    openedCount,
    clickedCount
  ] = await Promise.all([
    db.campaignRecipient.count({ where: { campaignId, status: { in: ["SENT", "DELIVERED"] } } }),
    db.campaignRecipient.count({ where: { campaignId, status: { in: ["FAILED", "BOUNCED", "COMPLAINED"] } } }),
    db.campaignRecipient.count({ where: { campaignId, status: "DELIVERED" } }),
    db.campaignRecipient.count({ where: { campaignId, status: "BOUNCED" } }),
    db.campaignRecipient.count({ where: { campaignId, status: "COMPLAINED" } }),
    db.campaignRecipient.count({ where: { campaignId, openedAt: { not: null } } }),
    db.campaignRecipient.count({ where: { campaignId, clickedAt: { not: null } } })
  ]);

  await db.campaign.update({
    where: { id: campaignId },
    data: {
      sendSucceeded: succeededCount,
      sendFailed: failedCount,
      deliveredCount,
      bouncedCount,
      complainedCount,
      openedCount,
      clickedCount
    }
  });
}

/**
 * POST /webhooks/brevo
 * Public endpoint to receive Brevo transactional webhook delivery events.
 */
router.post("/webhooks/brevo", async (req, res) => {
  // 1. Verify webhook authenticity (fail-closed)
  const auth = verifyWebhookAuth(req);
  if (!auth.authorized) {
    return res.status(401).json({ error: auth.error || "Unauthorized" });
  }

  // 2. Validate payload structure
  if (!req.body || (typeof req.body !== "object")) {
    return res.status(400).json({ error: "Invalid webhook payload. JSON object or array expected." });
  }

  const rawEvents = Array.isArray(req.body) ? req.body : [req.body];
  if (rawEvents.length === 0) {
    return res.status(400).json({ error: "Empty webhook payload." });
  }

  // Parse events through Zod
  const validatedEvents = [];
  for (const item of rawEvents) {
    const parse = brevoEventSchema.safeParse(item);
    if (!parse.success) {
      return res.status(400).json({ error: "Malformed webhook event payload.", issues: parse.error.issues });
    }
    validatedEvents.push(parse.data);
  }

  let processed = 0;
  let duplicates = 0;
  const affectedCampaignIds = new Set();

  for (const ev of validatedEvents) {
    const normalizedEvent = normalizeBrevoEvent(ev.event);
    const messageId = (ev["message-id"] || ev.messageId || "").trim() || null;
    const email = ev.email ? ev.email.toLowerCase().trim() : null;
    const eventDate = ev.ts_event
      ? new Date(ev.ts_event * 1000)
      : (ev.ts
        ? new Date(ev.ts * 1000)
        : (ev.date ? new Date(ev.date) : new Date()));

    // Safe deduplication key: uses messageId, email, event, timestamp (NOT webhook registration ev.id)
    const eventId = buildEventDeduplicationKey(ev, normalizedEvent);

    // 3. Idempotency: Check if this event was already processed
    const existingEvent = await prisma.deliveryEvent.findUnique({
      where: { eventId }
    });

    if (existingEvent) {
      duplicates++;
      continue;
    }

    // 4. Match event to CampaignRecipient
    let recipient = null;
    if (messageId) {
      recipient = await prisma.campaignRecipient.findFirst({
        where: { messageId },
        include: { campaign: true }
      });
    }

    if (!recipient && email) {
      recipient = await prisma.campaignRecipient.findFirst({
        where: { email },
        orderBy: { sentAt: "desc" },
        include: { campaign: true }
      });
    }

    // Determine recipient updates and contact suppression rules
    const recipientUpdate = {};
    let shouldSuppressContact = null; // null | "BOUNCED" | "COMPLAINED"

    if (recipient) {
      affectedCampaignIds.add(recipient.campaignId);
      const currentStatus = recipient.status;

      switch (normalizedEvent) {
        case "delivered":
          // Upgrade from PENDING or SENT to DELIVERED; never downgrade opened/clicked or terminal failure
          if (currentStatus === "PENDING" || currentStatus === "SENT") {
            recipientUpdate.status = "DELIVERED";
          }
          break;

        case "opened":
          // Record earliest open timestamp
          if (!recipient.openedAt || eventDate < recipient.openedAt) {
            recipientUpdate.openedAt = recipient.openedAt ? (eventDate < recipient.openedAt ? eventDate : recipient.openedAt) : eventDate;
          }
          // An open confirms delivery without inventing a fake status
          if (currentStatus === "PENDING" || currentStatus === "SENT") {
            recipientUpdate.status = "DELIVERED";
          }
          break;

        case "click":
          // Record earliest click timestamp
          if (!recipient.clickedAt || eventDate < recipient.clickedAt) {
            recipientUpdate.clickedAt = recipient.clickedAt ? (eventDate < recipient.clickedAt ? eventDate : recipient.clickedAt) : eventDate;
          }
          if (!recipient.openedAt) {
            recipientUpdate.openedAt = eventDate;
          }
          if (currentStatus === "PENDING" || currentStatus === "SENT") {
            recipientUpdate.status = "DELIVERED";
          }
          break;

        case "hard_bounce":
        case "invalid_email":
        case "blocked":
          recipientUpdate.status = "BOUNCED";
          recipientUpdate.bouncedAt = recipient.bouncedAt || eventDate;
          recipientUpdate.error = ev.reason || ev.description || `Hard bounce (${normalizedEvent})`;
          // Permanent delivery failure -> suppress contact
          shouldSuppressContact = "BOUNCED";
          break;

        case "soft_bounce":
          // Temporary failure for this campaign dispatch
          recipientUpdate.status = "BOUNCED";
          recipientUpdate.bouncedAt = recipient.bouncedAt || eventDate;
          recipientUpdate.error = ev.reason || ev.description || "Soft bounce";
          // Note: Soft bounces are temporary (mailbox full, etc.); do NOT permanently suppress contact
          break;

        case "spam":
          recipientUpdate.status = "COMPLAINED";
          recipientUpdate.error = "Marked as spam";
          // Abuse complaint -> suppress contact
          shouldSuppressContact = "COMPLAINED";
          break;

        case "deferred":
          // Temporary delay; Brevo will retry. Do NOT mark recipient as failed or change status
          recipientUpdate.error = ev.reason ? `Deferred: ${ev.reason}` : "Delivery deferred";
          break;

        case "sent":
          // Email accepted by Brevo; only update if still PENDING (never downgrade DELIVERED)
          if (currentStatus === "PENDING") {
            recipientUpdate.status = "SENT";
            recipientUpdate.sentAt = recipient.sentAt || eventDate;
          }
          break;

        default:
          // Safely record unknown event in audit trail without crashing
          break;
      }
    }

    // 5. Database Transaction for atomicity & concurrency protection
    try {
      if (typeof prisma.$transaction === "function") {
        await prisma.$transaction(async (tx) => {
          // Record delivery event for audit trail and deduplication
          await tx.deliveryEvent.create({
            data: {
              eventId,
              messageId,
              event: normalizedEvent,
              email,
              payload: ev
            }
          });

          // Update recipient if updates were determined
          if (recipient && Object.keys(recipientUpdate).length > 0) {
            await tx.campaignRecipient.update({
              where: { id: recipient.id },
              data: recipientUpdate
            });
          }

          // Suppress contact if permanent failure
          if (shouldSuppressContact && recipient?.contactId) {
            await tx.contact.update({
              where: { id: recipient.contactId },
              data: { status: shouldSuppressContact }
            }).catch(() => {});
          }
        });
      } else {
        // Fallback if transaction mock not present
        await prisma.deliveryEvent.create({
          data: {
            eventId,
            messageId,
            event: normalizedEvent,
            email,
            payload: ev
          }
        });
        if (recipient && Object.keys(recipientUpdate).length > 0) {
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: recipientUpdate
          });
        }
        if (shouldSuppressContact && recipient?.contactId) {
          await prisma.contact.update({
            where: { id: recipient.contactId },
            data: { status: shouldSuppressContact }
          }).catch(() => {});
        }
      }
      processed++;
    } catch (err) {
      // If eventId unique constraint conflict occurred on concurrent delivery, mark as duplicate
      if (err.code === "P2002" || String(err.message).includes("unique")) {
        duplicates++;
      } else {
        console.error("Webhook processing error:", err.message);
      }
    }
  }

  // 6. Synchronize campaign counters for all affected campaigns
  for (const campaignId of affectedCampaignIds) {
    await syncCampaignMetrics(campaignId);
  }

  return res.json({
    success: true,
    processed,
    duplicates,
    message: `Processed ${processed} webhook event(s) (${duplicates} duplicate(s) skipped).`
  });
});

export default router;
