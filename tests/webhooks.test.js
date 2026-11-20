import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import express from "express";

if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) {
  throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
}

const TEST_WEBHOOK_SECRET = "test_webhook_secret_key_12345";
process.env.BREVO_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

const { prisma } = vi.hoisted(() => ({
  prisma: {
    deliveryEvent: Object.fromEntries(
      ["findUnique", "create", "findMany"].map(k => [k, vi.fn()])
    ),
    campaignRecipient: Object.fromEntries(
      ["findFirst", "update", "count", "findMany"].map(k => [k, vi.fn()])
    ),
    campaign: Object.fromEntries(
      ["update", "findUnique", "findFirst"].map(k => [k, vi.fn()])
    ),
    contact: Object.fromEntries(
      ["update", "findUnique"].map(k => [k, vi.fn()])
    ),
    $transaction: vi.fn(async (cb) => {
      if (typeof cb === "function") {
        return cb(prisma);
      }
      return cb;
    })
  }
}));

vi.mock("../netlify/functions/_lib/db.mjs", () => ({ prisma, default: prisma }));

const { default: routes, buildEventDeduplicationKey, normalizeBrevoEvent, verifyWebhookAuth } = await import("../netlify/functions/routes/webhooks.mjs");
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
  process.env.BREVO_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
});

async function call(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {})
  };
  const response = await fetch(base + path, {
    ...options,
    headers
  });
  const clone = response.clone();
  return {
    response,
    body: await response.json().catch(() => null),
    text: await clone.text()
  };
}

describe("Audited & Hardened Brevo Webhooks API (/webhooks/brevo)", () => {
  const mockRecipient = {
    id: "cr-100",
    campaignId: "camp-999",
    contactId: "contact-1",
    email: "user@example.com",
    status: "SENT",
    messageId: "<202603301422.4815671@relay.domain.com>",
    sentAt: new Date("2026-11-16T10:00:00Z"),
    openedAt: null,
    clickedAt: null,
    bouncedAt: null,
    error: null
  };

  describe("1. Authentication Verification", () => {
    it("authenticates via Custom Header (X-Webhook-Secret)", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.findFirst.mockResolvedValue({ ...mockRecipient });
      prisma.campaignRecipient.update.mockResolvedValue({});
      prisma.campaignRecipient.count.mockResolvedValue(1);
      prisma.campaign.update.mockResolvedValue({});

      const { response, body } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          event: "delivered",
          id: 1234567, // Brevo webhook registration ID
          "message-id": "<202603301422.4815671@relay.domain.com>",
          email: "user@example.com",
          ts_event: 1780756509
        })
      });

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("authenticates via Bearer Token header", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.findFirst.mockResolvedValue({ ...mockRecipient });
      prisma.campaignRecipient.update.mockResolvedValue({});
      prisma.campaignRecipient.count.mockResolvedValue(1);
      prisma.campaign.update.mockResolvedValue({});

      const { response, body } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { authorization: `Bearer ${TEST_WEBHOOK_SECRET}` },
        body: JSON.stringify({
          event: "delivered",
          "message-id": "<202603301422.4815671@relay.domain.com>",
          ts_event: 1780756509
        })
      });

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("authenticates via Basic Auth credentials configured in URL", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.findFirst.mockResolvedValue({ ...mockRecipient });
      prisma.campaignRecipient.update.mockResolvedValue({});
      prisma.campaignRecipient.count.mockResolvedValue(1);
      prisma.campaign.update.mockResolvedValue({});

      const basicCreds = Buffer.from(`brevo:${TEST_WEBHOOK_SECRET}`).toString("base64");
      const { response, body } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { authorization: `Basic ${basicCreds}` },
        body: JSON.stringify({
          event: "delivered",
          "message-id": "<202603301422.4815671@relay.domain.com>",
          ts_event: 1780756509
        })
      });

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("fails closed when BREVO_WEBHOOK_SECRET is not configured on server", async () => {
      delete process.env.BREVO_WEBHOOK_SECRET;

      const { response, body } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": "some-secret" },
        body: JSON.stringify({ event: "delivered" })
      });

      expect(response.status).toBe(401);
      expect(body.error).toMatch(/BREVO_WEBHOOK_SECRET is not configured/i);
    });

    it("rejects unauthorized requests with invalid credentials", async () => {
      const { response, body } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": "wrong-secret-token" },
        body: JSON.stringify({ event: "delivered" })
      });

      expect(response.status).toBe(401);
      expect(body.error).toMatch(/unauthorized/i);
    });

    it("rejects unsupported query parameter authentication", async () => {
      // Query parameters are not an official Brevo authentication method and must be rejected
      const { response, body } = await call(`/webhooks/brevo?token=${TEST_WEBHOOK_SECRET}`, {
        method: "POST",
        body: JSON.stringify({ event: "delivered" })
      });

      expect(response.status).toBe(401);
      expect(body.error).toMatch(/unauthorized/i);
    });
  });

  describe("2. Payload Parsing & Webhook ID Audit", () => {
    it("handles realistic Brevo transactional payload with hyphenated message-id and passthrough metadata", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.findFirst.mockResolvedValue({ ...mockRecipient });
      prisma.campaignRecipient.update.mockResolvedValue({});
      prisma.campaignRecipient.count.mockResolvedValue(1);
      prisma.campaign.update.mockResolvedValue({});

      const realPayload = {
        event: "delivered",
        email: "recipient@example.com",
        id: 1234567, // Brevo webhook registration ID
        date: "2026-03-30 14:22:10",
        ts: 1743344530,
        "message-id": "<202603301422.4815671@relay.domain.com>",
        ts_event: 1743344535,
        subject: "Your Order Confirmation #1234",
        "X-Mailin-custom": "custom_header_value",
        sending_ip: "1.2.3.4",
        ts_epoch: 1743344530000,
        template_id: 8,
        tags: ["orderConfirmation", "ecommerce"],
        mirror_link: "https://sibautomation.com/s/1234567890",
        contact_id: 98765,
        source: "API"
      };

      const { response, body } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify(realPayload)
      });

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(prisma.campaignRecipient.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { messageId: "<202603301422.4815671@relay.domain.com>" }
        })
      );
    });

    it("does NOT treat Brevo's webhook 'id' as the unique event ID, allowing different events sharing the same webhook ID", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.findFirst.mockResolvedValue({ ...mockRecipient });
      prisma.campaignRecipient.update.mockResolvedValue({});
      prisma.campaignRecipient.count.mockResolvedValue(1);
      prisma.campaign.update.mockResolvedValue({});

      // Event 1: Delivered (webhook id = 99999)
      const ev1 = {
        event: "delivered",
        id: 99999,
        "message-id": "<msg-100@domain.com>",
        email: "user@example.com",
        ts_event: 1000
      };

      // Event 2: Opened (same webhook id = 99999, different timestamp)
      const ev2 = {
        event: "opened",
        id: 99999,
        "message-id": "<msg-100@domain.com>",
        email: "user@example.com",
        ts_event: 2000
      };

      const key1 = buildEventDeduplicationKey(ev1, "delivered");
      const key2 = buildEventDeduplicationKey(ev2, "opened");

      // Verify the deduplication keys are distinct even though ev1.id === ev2.id === 99999
      expect(key1).not.toBe(key2);

      const { response, body } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify([ev1, ev2])
      });

      expect(response.status).toBe(200);
      expect(body.processed).toBe(2);
      expect(body.duplicates).toBe(0);
    });

    it("rejects malformed payloads with 400 Bad Request", async () => {
      const { response, body } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({ randomField: "no event name" })
      });

      expect(response.status).toBe(400);
      expect(body.error).toMatch(/malformed webhook event/i);
    });
  });

  describe("3. Idempotency & Concurrency", () => {
    it("deduplicates identical events with same messageId, event, and timestamp", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue({
        id: "existing-event-id",
        eventId: "already-processed-hash"
      });

      const { response, body } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          event: "delivered",
          id: 12345,
          "message-id": "<msg-100@domain.com>",
          ts_event: 1743344530
        })
      });

      expect(response.status).toBe(200);
      expect(body.duplicates).toBe(1);
      expect(body.processed).toBe(0);
      expect(prisma.campaignRecipient.update).not.toHaveBeenCalled();
    });

    it("safely handles concurrent duplicate deliveries via unique constraint rollback", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.campaignRecipient.findFirst.mockResolvedValue({ ...mockRecipient });

      // Simulate a concurrent collision in the transaction where unique constraint throws P2002
      prisma.$transaction.mockRejectedValueOnce({
        code: "P2002",
        message: "Unique constraint failed on the fields: (eventId)"
      });

      const { response, body } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          event: "delivered",
          "message-id": "<msg-100@domain.com>",
          ts_event: 1743344530
        })
      });

      expect(response.status).toBe(200);
      expect(body.duplicates).toBe(1);
      expect(body.processed).toBe(0);
    });
  });

  describe("4. Delivery Status Semantics & Suppression Rules", () => {
    it("delivered event updates recipient status to DELIVERED", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.findFirst.mockResolvedValue({ ...mockRecipient, status: "SENT" });
      prisma.campaignRecipient.update.mockResolvedValue({});
      prisma.campaignRecipient.count.mockResolvedValue(1);
      prisma.campaign.update.mockResolvedValue({});

      const { response } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          event: "delivered",
          "message-id": "<202603301422.4815671@relay.domain.com>",
          ts_event: 1743344535
        })
      });

      expect(response.status).toBe(200);
      expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "DELIVERED" }
        })
      );
    });

    it("opened and clicked events update timestamps without inventing fake recipient statuses", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.findFirst.mockResolvedValue({
        ...mockRecipient,
        status: "DELIVERED",
        openedAt: null,
        clickedAt: null
      });
      prisma.campaignRecipient.update.mockResolvedValue({});
      prisma.campaignRecipient.count.mockResolvedValue(1);
      prisma.campaign.update.mockResolvedValue({});

      const openDate = new Date("2026-11-16T12:00:00Z");
      const { response } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          event: "click",
          "message-id": "<202603301422.4815671@relay.domain.com>",
          date: openDate.toISOString(),
          link: "https://example.com/checkout"
        })
      });

      expect(response.status).toBe(200);
      expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            openedAt: expect.any(Date),
            clickedAt: expect.any(Date)
          })
        })
      );
    });

    it("out-of-order delayed sent event does NOT downgrade an already DELIVERED recipient", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.findFirst.mockResolvedValue({
        ...mockRecipient,
        status: "DELIVERED" // Already delivered!
      });
      prisma.campaignRecipient.count.mockResolvedValue(1);
      prisma.campaign.update.mockResolvedValue({});

      // A delayed 'sent' or 'request' callback arrives
      const { response } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          event: "request",
          "message-id": "<202603301422.4815671@relay.domain.com>",
          ts_event: 100
        })
      });

      expect(response.status).toBe(200);
      // Status remains DELIVERED — update is not called with status: "SENT"
      expect(prisma.campaignRecipient.update).not.toHaveBeenCalled();
    });

    it("hard bounce permanently suppresses contact, while soft bounce does not suppress contact", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.update.mockResolvedValue({});
      prisma.contact.update.mockResolvedValue({});
      prisma.campaignRecipient.count.mockResolvedValue(1);
      prisma.campaign.update.mockResolvedValue({});

      // 1. Soft bounce: mailbox full (temporary)
      prisma.campaignRecipient.findFirst.mockResolvedValueOnce({ ...mockRecipient });
      await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          event: "soft_bounce",
          "message-id": "<202603301422.4815671@relay.domain.com>",
          reason: "Mailbox full"
        })
      });

      // Recipient is marked BOUNCED for this campaign
      expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "BOUNCED", error: "Mailbox full" })
        })
      );
      // BUT contact is NOT suppressed for soft bounce
      expect(prisma.contact.update).not.toHaveBeenCalled();

      // 2. Hard bounce: invalid mailbox (permanent failure)
      prisma.campaignRecipient.findFirst.mockResolvedValueOnce({ ...mockRecipient });
      await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          event: "hard_bounce",
          "message-id": "<202603301422.4815671@relay.domain.com>",
          reason: "550 User unknown"
        })
      });

      // Recipient is marked BOUNCED
      expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "BOUNCED" })
        })
      );
      // AND contact is permanently suppressed
      expect(prisma.contact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "contact-1" },
          data: { status: "BOUNCED" }
        })
      );
    });

    it("deferred event records error note without marking recipient as failed", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.findFirst.mockResolvedValue({ ...mockRecipient, status: "SENT" });
      prisma.campaignRecipient.update.mockResolvedValue({});
      prisma.campaignRecipient.count.mockResolvedValue(1);
      prisma.campaign.update.mockResolvedValue({});

      const { response } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          event: "deferred",
          "message-id": "<202603301422.4815671@relay.domain.com>",
          reason: "451 Greylisted, please try again later"
        })
      });

      expect(response.status).toBe(200);
      expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { error: "Deferred: 451 Greylisted, please try again later" }
        })
      );
      // Contact is never suppressed
      expect(prisma.contact.update).not.toHaveBeenCalled();
    });

    it("safely ignores unknown event types without crashing", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.findFirst.mockResolvedValue({ ...mockRecipient });
      prisma.campaignRecipient.count.mockResolvedValue(1);
      prisma.campaign.update.mockResolvedValue({});

      const { response, body } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          event: "some_future_brevo_event",
          "message-id": "<202603301422.4815671@relay.domain.com>"
        })
      });

      expect(response.status).toBe(200);
      expect(body.processed).toBe(1);
    });

    it("records unknown message-ids in audit table and returns 200 OK without crashing", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.findFirst.mockResolvedValue(null); // Not found!

      const { response, body } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          event: "delivered",
          "message-id": "<unknown-external-id@domain.com>"
        })
      });

      expect(response.status).toBe(200);
      expect(body.processed).toBe(1);
      expect(prisma.deliveryEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            messageId: "<unknown-external-id@domain.com>",
            event: "delivered"
          })
        })
      );
    });
  });

  describe("5. Counter Consistency", () => {
    it("maintains accurate campaign counters across events", async () => {
      prisma.deliveryEvent.findUnique.mockResolvedValue(null);
      prisma.deliveryEvent.create.mockResolvedValue({});
      prisma.campaignRecipient.findFirst.mockResolvedValue({ ...mockRecipient });
      prisma.campaignRecipient.update.mockResolvedValue({});

      prisma.campaignRecipient.count
        .mockResolvedValueOnce(10) // succeeded
        .mockResolvedValueOnce(2)  // failed
        .mockResolvedValueOnce(8)  // delivered
        .mockResolvedValueOnce(1)  // bounced
        .mockResolvedValueOnce(1)  // complained
        .mockResolvedValueOnce(6)  // opened
        .mockResolvedValueOnce(3); // clicked

      prisma.campaign.update.mockResolvedValue({});

      const { response } = await call("/webhooks/brevo", {
        method: "POST",
        headers: { "x-webhook-secret": TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          event: "delivered",
          "message-id": "<202603301422.4815671@relay.domain.com>",
          ts_event: 1743344535
        })
      });

      expect(response.status).toBe(200);
      expect(prisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "camp-999" },
          data: expect.objectContaining({
            sendSucceeded: 10,
            sendFailed: 2,
            deliveredCount: 8,
            bouncedCount: 1,
            complainedCount: 1,
            openedCount: 6,
            clickedCount: 3
          })
        })
      );
    });
  });
});
