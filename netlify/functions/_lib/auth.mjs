import jwt from "jsonwebtoken";
import { prisma } from "./db.mjs";

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000
};

export function issueSession(res, user) {
  const token = jwt.sign(
    { sub: user.id },
    process.env.JWT_SECRET || "default_jwt_secret_dev",
    { expiresIn: "7d" }
  );
  res.cookie("mf_session", token, cookieOptions);
}

export async function auth(req, res, next) {
  try {
    const token = req.cookies?.mf_session || req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Please sign in." });

    const payload = jwt.verify(token, process.env.JWT_SECRET || "default_jwt_secret_dev");
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: {
          include: { workspace: true }
        }
      }
    });

    if (!user) return res.status(401).json({ error: "Account not found." });

    const primaryMembership = user.memberships[0];
    req.user = user;
    req.workspace = primaryMembership?.workspace;
    req.role = primaryMembership?.role || "VIEWER";

    next();
  } catch {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.role || !allowedRoles.includes(req.role)) {
      return res.status(403).json({ error: "You do not have permission to perform this action." });
    }
    next();
  };
}

// Serverless-safe login throttling using DB
export async function checkLoginThrottle(key) {
  try {
    const record = await prisma.loginAttempt.findUnique({ where: { key } });
    if (record?.lockedUntil && record.lockedUntil > new Date()) {
      return { locked: true, lockedUntil: record.lockedUntil };
    }
    return { locked: false };
  } catch {
    return { locked: false };
  }
}

export async function recordFailedLogin(key) {
  try {
    const existing = await prisma.loginAttempt.findUnique({ where: { key } });
    if (!existing) {
      await prisma.loginAttempt.create({
        data: { key, attempts: 1 }
      });
    } else {
      const attempts = existing.attempts + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 5 * 60 * 1000) : null;
      await prisma.loginAttempt.update({
        where: { key },
        data: { attempts, lockedUntil }
      });
    }
  } catch (err) {
    console.error("Failed to record login attempt", err);
  }
}

export async function resetLoginThrottle(key) {
  try {
    await prisma.loginAttempt.deleteMany({ where: { key } });
  } catch {}
}
