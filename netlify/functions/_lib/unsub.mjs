import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  const value = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;
  if (!value || value === "default_jwt_secret_dev") throw new Error("UNSUBSCRIBE_SECRET must be configured");
  return value;
}

export function signUnsubscribeToken({ contactId, workspaceId, expiresInSeconds = 60 * 60 * 24 * 30 }) {
  const payload = Buffer.from(JSON.stringify({
    contactId,
    workspaceId,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyUnsubscribeToken(token) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  try {
    const expected = createHmac("sha256", secret()).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.contactId || !data.workspaceId || !Number.isInteger(data.exp) || data.exp <= Math.floor(Date.now() / 1000)) return null;
    return { contactId: data.contactId, workspaceId: data.workspaceId, exp: data.exp };
  } catch {
    return null;
  }
}

export function listUnsubscribeHeaders({ contactId, workspaceId, baseUrl = process.env.PUBLIC_APP_URL }) {
  if (!baseUrl) throw new Error("PUBLIC_APP_URL must be configured");
  const token = signUnsubscribeToken({ contactId, workspaceId });
  const url = `${baseUrl.replace(/\/$/, "")}/api/unsubscribe?token=${encodeURIComponent(token)}`;
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
  };
}
