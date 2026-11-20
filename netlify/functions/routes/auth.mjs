import express from "express";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { prisma } from "../_lib/db.mjs";
import {
  auth,
  issueSession,
  cookieOptions,
  checkLoginThrottle,
  recordFailedLogin,
  resetLoginThrottle
} from "../_lib/auth.mjs";

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function createWorkspace(user, name) {
  const workspace = await prisma.workspace.create({ data: { name } });
  await prisma.workspaceMember.create({
    data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" }
  });
  return workspace;
}

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(100)
});

router.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Enter a valid name, email and password of at least 8 characters." });
  }

  const { name, email, password } = parsed.data;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email: email.toLowerCase(), passwordHash }
    });
    await createWorkspace(user, `${name}'s Workspace`);
    issueSession(res, user);
    return res.status(201).json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    // Only return 409 for Prisma P2002 (unique constraint violation), otherwise 500
    if (e?.code === "P2002") {
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    console.error("Registration error:", e);
    return res.status(500).json({ error: "Unable to create account. Please try again later." });
  }
});

router.post("/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const ip = req.ip || req.headers["x-forwarded-for"] || "local";
  const throttleKey = `${email}:${ip}`;

  // Check login throttling
  const throttleStatus = await checkLoginThrottle(throttleKey);
  if (throttleStatus.locked) {
    return res.status(429).json({
      error: "Too many failed login attempts. Please try again in 5 minutes."
    });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    await recordFailedLogin(throttleKey);
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  // Reset throttling upon successful login
  await resetLoginThrottle(throttleKey);

  issueSession(res, user);
  return res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

router.post("/auth/google", async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: "Google login is not configured yet." });
    }
    const ticket = await googleClient.verifyIdToken({
      idToken: req.body?.credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const p = ticket.getPayload();
    if (!p?.email || !p.email_verified) {
      return res.status(401).json({ error: "Google account email is not verified." });
    }

    let user = await prisma.user.findUnique({
      where: { email: p.email.toLowerCase() },
      include: { memberships: true }
    });

    if (user) {
      if (user.googleSub && user.googleSub !== p.sub) {
        return res.status(409).json({ error: "This email is linked to a different Google identity." });
      }
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleSub: p.sub, avatarUrl: p.picture || user.avatarUrl }
      });
    } else {
      user = await prisma.user.create({
        data: {
          name: p.name || p.email.split("@")[0],
          email: p.email.toLowerCase(),
          googleSub: p.sub,
          avatarUrl: p.picture
        }
      });
      await createWorkspace(user, `${user.name}'s Workspace`);
    }

    issueSession(res, user);
    return res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch {
    return res.status(401).json({ error: "Google sign-in could not be verified." });
  }
});

router.get("/auth/me", auth, async (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.role
    },
    workspace: req.workspace ? { id: req.workspace.id, name: req.workspace.name, role: req.role } : null
  });
});

router.post("/auth/logout", (req, res) => {
  res.clearCookie("mf_session", { ...cookieOptions, maxAge: 0 });
  res.json({ ok: true });
});

export default router;
