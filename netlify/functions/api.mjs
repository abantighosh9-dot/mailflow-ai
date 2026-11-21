import serverless from "serverless-http";
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.mjs";
import dashboardRoutes from "./routes/dashboard.mjs";
import aiRoutes from "./routes/ai.mjs";
import templatesRoutes from "./routes/templates.mjs";
import contactsRoutes from "./routes/contacts.mjs";
import campaignsRoutes from "./routes/campaigns.mjs";
import unsubscribeRoutes from "./routes/unsubscribe.mjs";
import webhooksRoutes from "./routes/webhooks.mjs";
import analyticsRoutes from "./routes/analytics.mjs";
import workflowsRoutes from "./routes/workflows.mjs";
import deliverabilityRoutes from "./routes/deliverability.mjs";

const app = express();
const router = express.Router();

app.use(cors({ origin: process.env.CLIENT_URL || true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// Safe body parser for serverless Buffer bodies
app.use((req, res, next) => {
  if (Buffer.isBuffer(req.body)) {
    try {
      req.body = JSON.parse(req.body.toString("utf8"));
    } catch {}
  } else if (typeof req.body === "string" && req.body) {
    try {
      req.body = JSON.parse(req.body);
    } catch {}
  }
  next();
});

// Safe cookie parser with try/catch for decodeURIComponent
app.use((req, res, next) => {
  const raw = req.headers.cookie || "";
  req.cookies = Object.fromEntries(
    raw
      .split(";")
      .filter(Boolean)
      .map(p => {
        const i = p.indexOf("=");
        if (i === -1) return [p.trim(), ""];
        const key = p.slice(0, i).trim();
        let val = p.slice(i + 1).trim();
        try {
          val = decodeURIComponent(val);
        } catch {
          // If malformed URI, preserve raw string instead of throwing
        }
        return [key, val];
      })
  );
  next();
});

// Health check endpoint
router.get("/health", (_req, res) => res.json({ ok: true, service: "MailFlow AI API" }));

// Mount split modular routes
router.use(authRoutes);
router.use(dashboardRoutes);
router.use(aiRoutes);
router.use(templatesRoutes);
router.use(contactsRoutes);
router.use(campaignsRoutes);
router.use(unsubscribeRoutes);
router.use(webhooksRoutes);
router.use(analyticsRoutes);
router.use(workflowsRoutes);
router.use(deliverabilityRoutes);

// Route handlers for Netlify function redirects and direct calls
app.use(["/.netlify/functions/api", "/api", "/"], router);

export const handler = serverless(app);
export { app };
