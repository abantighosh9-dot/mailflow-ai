import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendTransactionalEmail } from "../netlify/functions/_lib/brevo.mjs";

if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) {
  throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
}

describe("Brevo Service Module (netlify/functions/_lib/brevo.mjs)", () => {
  const originalFetch = globalThis.fetch;
  const originalEnvKey = process.env.BREVO_API_KEY;

  beforeEach(() => {
    process.env.BREVO_API_KEY = "test-brevo-key-12345";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnvKey !== undefined) {
      process.env.BREVO_API_KEY = originalEnvKey;
    } else {
      delete process.env.BREVO_API_KEY;
    }
  });

  it("fails early if BREVO_API_KEY is not configured", async () => {
    delete process.env.BREVO_API_KEY;
    const result = await sendTransactionalEmail({
      apiKey: "",
      sender: { email: "sender@example.com" },
      to: "recipient@example.com",
      subject: "Hello",
      htmlContent: "<p>Test</p>"
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("MISSING_API_KEY");
    expect(result.error).toMatch(/BREVO_API_KEY is not configured/i);
  });

  it("validates sender email address", async () => {
    const result = await sendTransactionalEmail({
      sender: { email: "not-an-email" },
      to: "recipient@example.com",
      subject: "Hello",
      htmlContent: "<p>Test</p>"
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_SENDER");
  });

  it("validates subject and content", async () => {
    const missingSubject = await sendTransactionalEmail({
      sender: { email: "sender@example.com" },
      to: "recipient@example.com",
      subject: "   ",
      htmlContent: "<p>Test</p>"
    });
    expect(missingSubject.code).toBe("INVALID_SUBJECT");

    const missingContent = await sendTransactionalEmail({
      sender: { email: "sender@example.com" },
      to: "recipient@example.com",
      subject: "Subject",
      htmlContent: "   "
    });
    expect(missingContent.code).toBe("INVALID_CONTENT");
  });

  it("validates recipient email address", async () => {
    const result = await sendTransactionalEmail({
      sender: { email: "sender@example.com" },
      to: [],
      subject: "Hello",
      htmlContent: "<p>Test</p>"
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_RECIPIENT");
  });

  it("successfully calls Brevo REST endpoint and returns messageId", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ messageId: "<202611161200.abcdef@smtp-relay.brevo.com>" })
    });

    const result = await sendTransactionalEmail({
      sender: { name: "Sender", email: "sender@example.com" },
      to: [{ email: "user@example.com", name: "User" }],
      subject: "Welcome",
      htmlContent: "<h1>Welcome</h1>",
      headers: { "List-Unsubscribe": "<https://example.com/unsub>" },
      tags: ["welcome", "onboarding"]
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("<202611161200.abcdef@smtp-relay.brevo.com>");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/smtp/email",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "api-key": "test-brevo-key-12345"
        })
      })
    );
  });

  it("handles provider 400 error safely without throwing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: "invalid_parameter", message: "Domain not authenticated" })
    });

    const result = await sendTransactionalEmail({
      sender: { email: "sender@unverified.com" },
      to: "recipient@example.com",
      subject: "Test",
      htmlContent: "<p>Hello</p>"
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Domain not authenticated");
    expect(result.code).toBe("invalid_parameter");
  });

  it("handles network failure safely", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await sendTransactionalEmail({
      sender: { email: "sender@example.com" },
      to: "recipient@example.com",
      subject: "Test",
      htmlContent: "<p>Hello</p>"
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("NETWORK_ERROR");
  });
});
