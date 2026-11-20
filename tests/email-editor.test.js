import { describe, expect, it } from "vitest";
import { sanitizeHtml, applySamplePlaceholders } from "../src/components/EmailEditor.jsx";

if (/neon\.tech|neon\.database|neon\.db/i.test(process.env.DATABASE_URL || "")) {
  throw new Error("Refusing to run tests with a production Neon DATABASE_URL.");
}

describe("EmailEditor - HTML sanitization", () => {
  it("removes script tags and script execution contents", () => {
    const malicious = '<h1>Welcome</h1><script>alert("hack")</script><p>Enjoy!</p>';
    const sanitized = sanitizeHtml(malicious);
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("alert");
    expect(sanitized).toContain("<h1>Welcome</h1>");
    expect(sanitized).toContain("<p>Enjoy!</p>");
  });

  it("strips inline event handler attributes like onerror and onclick", () => {
    const malicious = '<img src="invalid.jpg" onerror="alert(1)" /><button onclick="doBad()">Click</button>';
    const sanitized = sanitizeHtml(malicious);
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("alert(1)");
  });

  it("strips dangerous javascript: and vbscript: URIs in links and actions", () => {
    const malicious = '<a href="javascript:stealData()">Claim Prize</a><a href="https://example.com">Safe Link</a>';
    const sanitized = sanitizeHtml(malicious);
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("stealData()");
    expect(sanitized).toContain('href="https://example.com"');
    expect(sanitized).toContain("Safe Link");
  });

  it("preserves safe HTML email formatting (headings, paragraphs, styles, images)", () => {
    const safeEmail = '<div style="background:#fff;padding:20px;"><h2 style="color:#333;">Newsletter</h2><p>Hello world!</p><a href="https://example.com/promo">Shop Now</a></div>';
    const sanitized = sanitizeHtml(safeEmail);
    expect(sanitized).toContain("Newsletter");
    expect(sanitized).toContain("Hello world!");
    expect(sanitized).toContain('href="https://example.com/promo"');
  });

  it("handles empty or null inputs gracefully", () => {
    expect(sanitizeHtml("")).toBe("");
    expect(sanitizeHtml(null)).toBe("");
    expect(sanitizeHtml(undefined)).toBe("");
  });
});

describe("EmailEditor - Personalization placeholder substitution", () => {
  it("replaces {{firstName}}, {{lastName}}, {{email}}, and {{company}} with realistic sample data", () => {
    const template = "Hello {{firstName}} {{lastName}} from {{company}}! We sent this to {{email}}.";
    const result = applySamplePlaceholders(template);

    expect(result).toContain("Jane");
    expect(result).toContain("Doe");
    expect(result).toContain("Acme Corp");
    expect(result).toContain("jane.doe@example.com");
    expect(result).not.toContain("{{firstName}}");
    expect(result).not.toContain("{{company}}");
  });

  it("handles whitespace variations inside placeholders like {{ firstName }}", () => {
    const template = "Dear {{ firstName }}, welcome to {{ company }}!";
    const result = applySamplePlaceholders(template);

    expect(result).toContain("Jane");
    expect(result).toContain("Acme Corp");
    expect(result).not.toContain("{{ firstName }}");
  });

  it("handles empty or missing text safely", () => {
    expect(applySamplePlaceholders("")).toBe("");
    expect(applySamplePlaceholders(null)).toBe("");
    expect(applySamplePlaceholders(undefined)).toBe("");
  });
});
