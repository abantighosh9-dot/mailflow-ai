import express from "express";
import { prisma } from "../_lib/db.mjs";
import { auth } from "../_lib/auth.mjs";

const router = express.Router();

router.get("/dashboard", auth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(400).json({ error: "No workspace is assigned to this account." });
  }

  try {
    const [contacts, campaigns, templates, sent] = await Promise.all([
      prisma.contact.count({ where: { workspaceId } }),
      prisma.campaign.count({ where: { workspaceId } }),
      prisma.emailTemplate.count({ where: { workspaceId } }),
      prisma.campaign.count({ where: { workspaceId, status: "SENT" } })
    ]);

    return res.json({ stats: { contacts, campaigns, templates, sent } });
  } catch (err) {
    console.error("Dashboard stats error:", err);
    return res.status(500).json({ error: "Failed to load dashboard metrics." });
  }
});

export default router;
