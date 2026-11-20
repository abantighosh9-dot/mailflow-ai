import express from "express";
import { z } from "zod";
import { prisma } from "../_lib/db.mjs";
import { auth, requireRole } from "../_lib/auth.mjs";
import {
  generateEmailDraft,
  suggestSubjectLines,
  improveEmailContent,
  analyzeBrandSample,
  handleAIError,
  scrubProhibitedPhrases
} from "../_lib/ai-email.mjs";
import {
  analyzeCampaignPerformance
} from "../_lib/ai-optimizer.mjs";

const router = express.Router();

const VALID_MODES = ["rewrite", "shorten", "expand", "clarify", "change_tone", "fix_grammar", "improve_cta"];

const brandVoiceSchema = z.object({
  brandName: z.string().trim().max(100, "Brand name cannot exceed 100 characters").optional().default(""),
  businessDescription: z.string().trim().max(1000, "Business description cannot exceed 1000 characters").optional().default(""),
  industry: z.string().trim().max(100, "Industry cannot exceed 100 characters").optional().default(""),
  targetAudience: z.string().trim().max(500, "Target audience cannot exceed 500 characters").optional().default(""),
  preferredTone: z.string().trim().max(80, "Tone cannot exceed 80 characters").optional().default("Professional"),
  brandPersonality: z.string().trim().max(500, "Brand personality cannot exceed 500 characters").optional().default(""),
  preferredVocabulary: z.union([
    z.array(z.string().trim().max(80)),
    z.string().transform(s => s.split(",").map(x => x.trim()).filter(Boolean))
  ]).optional().default([]),
  prohibitedPhrases: z.union([
    z.array(z.string().trim().max(80)),
    z.string().transform(s => s.split(",").map(x => x.trim()).filter(Boolean))
  ]).optional().default([]),
  styleGuidelines: z.string().trim().max(2000, "Style guidelines cannot exceed 2000 characters").optional().default(""),
  defaultLanguage: z.string().trim().max(50, "Default language cannot exceed 50 characters").optional().default("English"),
  websiteUrl: z.string().trim().max(200).optional().default("")
});

const analyzeSampleSchema = z.object({
  sample: z.string().trim().min(20, "Please provide a writing sample of at least 20 characters.").max(8000, "Sample cannot exceed 8000 characters.")
});

const generateEmailSchema = z.object({
  prompt: z.string().min(5, "Please provide a campaign description of at least 5 characters.").max(4000).optional(),
  description: z.string().min(5, "Please provide a campaign description of at least 5 characters.").max(4000).optional(),
  purpose: z.string().max(100).optional(),
  tone: z.string().max(80).optional(),
  audience: z.string().max(200).optional(),
  brandName: z.string().max(100).optional(),
  language: z.string().max(50).optional(),
  keyMessage: z.string().max(500).optional(),
  cta: z.string().max(100).optional(),
  ctaUrl: z.string().max(500).optional(),
  keywords: z.union([z.array(z.string().max(50)), z.string().max(200)]).optional(),
  useBrandVoice: z.boolean().optional().default(true)
}).refine(data => Boolean(data.prompt?.trim() || data.description?.trim()), {
  message: "Please provide a campaign description of at least 5 characters.",
  path: ["prompt"]
});

const personalizedEmailSchema = z.object({
  prompt: z.string().min(5, "Please provide a campaign description of at least 5 characters.").max(4000).optional(),
  description: z.string().min(5, "Please provide a campaign description of at least 5 characters.").max(4000).optional(),
  purpose: z.string().max(100).optional(),
  tone: z.string().max(80).optional(),
  audience: z.string().max(200).optional(),
  targetTags: z.array(z.string().max(50)).optional(),
  contactSample: z.object({
    firstName: z.string().max(50).optional(),
    lastName: z.string().max(50).optional(),
    company: z.string().max(100).optional(),
    tags: z.array(z.string().max(50)).optional()
  }).optional(),
  cta: z.string().max(100).optional(),
  ctaUrl: z.string().max(500).optional(),
  language: z.string().max(50).optional(),
  useBrandVoice: z.boolean().optional().default(true),
  brandVoiceOverride: z.record(z.any()).optional()
}).refine(data => Boolean(data.prompt?.trim() || data.description?.trim()), {
  message: "Please provide a campaign description of at least 5 characters.",
  path: ["prompt"]
});

const suggestSubjectsSchema = z.object({
  context: z.string().min(3, "Please provide context or campaign details for subject line generation.").max(4000),
  currentSubject: z.string().max(200).optional(),
  tone: z.string().max(80).optional(),
  count: z.number().int().min(1).max(10).optional().default(5),
  useBrandVoice: z.boolean().optional().default(true)
});

const improveContentSchema = z.object({
  content: z.string().min(3, "Please provide content to improve.").max(20000),
  mode: z.string().refine(val => VALID_MODES.includes(val), {
    message: "Mode must be one of: rewrite, shorten, expand, clarify, change_tone, fix_grammar, improve_cta."
  }),
  tone: z.string().max(80).optional(),
  instruction: z.string().max(500).optional(),
  useBrandVoice: z.boolean().optional().default(true)
});

const analyzeCampaignSchema = z.object({
  useBrandVoice: z.boolean().optional().default(true)
});

const optimizeCampaignSchema = z.object({
  action: z.enum(["analyze_and_suggest", "apply_recommendations"]).optional().default("analyze_and_suggest"),
  useBrandVoice: z.boolean().optional().default(true),
  applyChanges: z.object({
    subject: z.string().trim().min(1, "Subject cannot be empty").max(500, "Subject line too long").optional(),
    previewText: z.string().trim().max(300, "Preview text too long").optional().nullable(),
    html: z.string().optional(),
    targetTags: z.array(z.string().trim().toLowerCase()).max(50).optional(),
    duplicateAsDraftIfSent: z.boolean().optional().default(false)
  }).optional()
});

/**
 * Helper to fetch brand voice for workspace if enabled.
 */
async function resolveWorkspaceBrandVoice(workspaceId, useBrandVoice) {
  if (!useBrandVoice || !workspaceId) return null;
  try {
    return await prisma.brandVoice.findUnique({
      where: { workspaceId }
    });
  } catch (err) {
    console.error("Failed to fetch brand voice for workspace", err);
    return null;
  }
}

/**
 * GET /ai/brand-voice
 * Retrieves workspace brand voice settings. Accessible to all workspace members.
 */
router.get("/ai/brand-voice", auth, async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(400).json({ error: "Missing workspace context" });
  }

  try {
    const brandVoice = await prisma.brandVoice.findUnique({
      where: { workspaceId }
    });

    if (!brandVoice) {
      return res.json({
        brandVoice: {
          brandName: "",
          businessDescription: "",
          industry: "",
          targetAudience: "",
          preferredTone: "Professional",
          brandPersonality: "",
          preferredVocabulary: [],
          prohibitedPhrases: [],
          styleGuidelines: "",
          defaultLanguage: "English",
          websiteUrl: ""
        }
      });
    }

    return res.json({ brandVoice });
  } catch (e) {
    console.error("Failed to get brand voice", e);
    return res.status(500).json({ error: "Failed to retrieve brand voice settings." });
  }
});

/**
 * PUT /ai/brand-voice
 * Updates workspace brand voice settings. Restricted to OWNER and ADMIN.
 */
router.put("/ai/brand-voice", auth, requireRole("OWNER", "ADMIN"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(400).json({ error: "Missing workspace context" });
  }

  const parsed = brandVoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues?.[0]?.message || parsed.error.errors?.[0]?.message || "Invalid brand voice settings.";
    return res.status(400).json({ error: errorMsg });
  }

  try {
    const data = parsed.data;
    const brandVoice = await prisma.brandVoice.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        ...data
      },
      update: data
    });

    return res.json({ brandVoice });
  } catch (e) {
    console.error("Failed to update brand voice", e);
    return res.status(500).json({ error: "Failed to save brand voice settings." });
  }
});

/**
 * POST /ai/brand-voice/analyze-sample
 * Analyzes a writing sample to detect tone, personality, keywords, and style guidelines.
 * Prompt injection defense: sample is quarantined as untrusted content.
 */
router.post("/ai/brand-voice/analyze-sample", auth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const parsed = analyzeSampleSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues?.[0]?.message || parsed.error.errors?.[0]?.message || "Invalid writing sample.";
    return res.status(400).json({ error: errorMsg });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "AI generation is not configured. Add OPENAI_API_KEY to your environment." });
  }

  try {
    const analysis = await analyzeBrandSample(parsed.data);
    return res.json({ analysis });
  } catch (e) {
    return handleAIError(e, res);
  }
});

/**
 * POST /ai/generate-email
 * Generates a full structured marketing email draft, optionally applying brand voice.
 */
router.post("/ai/generate-email", auth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const parsed = generateEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues?.[0]?.message || parsed.error.errors?.[0]?.message || "Invalid email generation parameters.";
    return res.status(400).json({ error: errorMsg });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "AI generation is not configured. Add OPENAI_API_KEY to your environment." });
  }

  try {
    const brandVoice = await resolveWorkspaceBrandVoice(req.workspace?.id, parsed.data.useBrandVoice);
    const email = await generateEmailDraft({
      ...parsed.data,
      brandVoice
    });
    return res.json({ email, appliedBrandVoice: Boolean(brandVoice) });
  } catch (e) {
    return handleAIError(e, res);
  }
});

/**
 * POST /ai/generate-personalized
 * Generates a personalized email draft for an audience segment or contact sample.
 */
router.post("/ai/generate-personalized", auth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const parsed = personalizedEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues?.[0]?.message || parsed.error.errors?.[0]?.message || "Invalid personalization parameters.";
    return res.status(400).json({ error: errorMsg });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "AI generation is not configured. Add OPENAI_API_KEY to your environment." });
  }

  try {
    let brandVoice = parsed.data.brandVoiceOverride || null;
    if (!brandVoice && parsed.data.useBrandVoice) {
      brandVoice = await resolveWorkspaceBrandVoice(req.workspace?.id, true);
    }

    const email = await generateEmailDraft({
      ...parsed.data,
      brandVoice,
      targetTags: parsed.data.targetTags,
      contactSample: parsed.data.contactSample
    });

    return res.json({ email, appliedBrandVoice: Boolean(brandVoice) });
  } catch (e) {
    return handleAIError(e, res);
  }
});

/**
 * POST /ai/suggest-subjects
 * Suggests subject lines, optionally respecting workspace brand voice.
 */
router.post("/ai/suggest-subjects", auth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const parsed = suggestSubjectsSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues?.[0]?.message || parsed.error.errors?.[0]?.message || "Invalid subject suggestion parameters.";
    return res.status(400).json({ error: errorMsg });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "AI generation is not configured. Add OPENAI_API_KEY to your environment." });
  }

  try {
    const brandVoice = await resolveWorkspaceBrandVoice(req.workspace?.id, parsed.data.useBrandVoice);
    const result = await suggestSubjectLines({
      ...parsed.data,
      brandVoice
    });
    return res.json({ ...result, appliedBrandVoice: Boolean(brandVoice) });
  } catch (e) {
    return handleAIError(e, res);
  }
});

/**
 * POST /ai/improve-content
 * Refines email copy, optionally respecting workspace brand voice.
 */
router.post("/ai/improve-content", auth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const parsed = improveContentSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues?.[0]?.message || parsed.error.errors?.[0]?.message || "Invalid content improvement parameters.";
    return res.status(400).json({ error: errorMsg });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "AI generation is not configured. Add OPENAI_API_KEY to your environment." });
  }

  try {
    const brandVoice = await resolveWorkspaceBrandVoice(req.workspace?.id, parsed.data.useBrandVoice);
    const result = await improveEmailContent({
      ...parsed.data,
      brandVoice
    });
    return res.json({ ...result, appliedBrandVoice: Boolean(brandVoice) });
  } catch (e) {
    return handleAIError(e, res);
  }
});

/**
 * POST /ai/analyze-campaign/:campaignId
 * Diagnostic analysis of a campaign's performance metrics, copy heuristics, and send timing.
 * Open to OWNER, ADMIN, EDITOR, ANALYST, and VIEWER roles.
 */
router.post("/ai/analyze-campaign/:campaignId", auth, requireRole("OWNER", "ADMIN", "EDITOR", "ANALYST", "VIEWER"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { campaignId } = req.params;

  if (!workspaceId) {
    return res.status(400).json({ error: "Missing workspace context" });
  }

  const parsed = analyzeCampaignSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const errorMsg = parsed.error.issues?.[0]?.message || parsed.error.errors?.[0]?.message || "Invalid analysis request parameters.";
    return res.status(400).json({ error: errorMsg });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "AI generation is not configured. Add OPENAI_API_KEY to your environment." });
  }

  try {
    const result = await analyzeCampaignPerformance({
      workspaceId,
      campaignId,
      useBrandVoice: parsed.data.useBrandVoice
    });
    return res.json(result);
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ error: e.message || "Campaign not found" });
    }
    return handleAIError(e, res);
  }
});

/**
 * POST /ai/optimize-campaign/:campaignId
 * Performance optimization engine: generates recommendations OR safely applies approved changes.
 * Restricted to OWNER, ADMIN, and EDITOR roles.
 */
router.post("/ai/optimize-campaign/:campaignId", auth, requireRole("OWNER", "ADMIN", "EDITOR"), async (req, res) => {
  const workspaceId = req.workspace?.id;
  const { campaignId } = req.params;

  if (!workspaceId) {
    return res.status(400).json({ error: "Missing workspace context" });
  }

  const parsed = optimizeCampaignSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const errorMsg = parsed.error.issues?.[0]?.message || parsed.error.errors?.[0]?.message || "Invalid optimization parameters.";
    return res.status(400).json({ error: errorMsg });
  }

  const { action, useBrandVoice, applyChanges } = parsed.data;

  // 1. If applying changes to campaign
  if (action === "apply_recommendations" || (applyChanges && Object.keys(applyChanges).length > 0)) {
    try {
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, workspaceId }
      });

      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      // If campaign is not DRAFT, check if user requested duplicating as a draft
      if (campaign.status !== "DRAFT") {
        if (applyChanges?.duplicateAsDraftIfSent) {
          const brandVoice = await resolveWorkspaceBrandVoice(workspaceId, useBrandVoice);
          const prohibited = brandVoice?.prohibitedPhrases || [];

          const scrub = text => scrubProhibitedPhrases(text, prohibited);

          const subject = applyChanges.subject !== undefined ? scrub(applyChanges.subject) : campaign.subject;
          const previewText = applyChanges.previewText !== undefined ? scrub(applyChanges.previewText) : campaign.previewText;
          const html = applyChanges.html !== undefined ? applyChanges.html : campaign.html;
          const targetTags = applyChanges.targetTags !== undefined ? applyChanges.targetTags : campaign.targetTags;

          const newDraft = await prisma.campaign.create({
            data: {
              workspaceId,
              name: `${campaign.name} (Optimized Copy)`,
              subject,
              previewText,
              html,
              targetTags,
              fromName: campaign.fromName,
              fromEmail: campaign.fromEmail,
              description: `Created from campaign "${campaign.name}" via AI Performance Optimizer.`,
              templateId: campaign.templateId,
              status: "DRAFT"
            }
          });

          return res.status(201).json({
            success: true,
            duplicated: true,
            message: `Created new optimized draft campaign "${newDraft.name}".`,
            campaign: newDraft
          });
        }

        return res.status(400).json({
          error: `Cannot directly modify a ${campaign.status} campaign. Only DRAFT campaigns can be modified. You may duplicate it as an optimized draft.`
        });
      }

      // Campaign IS DRAFT -> safely apply changes
      const brandVoice = await resolveWorkspaceBrandVoice(workspaceId, useBrandVoice);
      const prohibited = brandVoice?.prohibitedPhrases || [];
      const scrub = text => scrubProhibitedPhrases(text, prohibited);

      const updateData = {};
      if (applyChanges?.subject !== undefined) updateData.subject = scrub(applyChanges.subject);
      if (applyChanges?.previewText !== undefined) updateData.previewText = scrub(applyChanges.previewText);
      if (applyChanges?.html !== undefined) updateData.html = applyChanges.html;
      if (applyChanges?.targetTags !== undefined) updateData.targetTags = applyChanges.targetTags;

      const updated = await prisma.campaign.update({
        where: { id: campaignId },
        data: updateData
      });

      return res.json({
        success: true,
        message: "Campaign updated with approved optimization recommendations.",
        campaign: updated
      });
    } catch (e) {
      console.error("Failed to apply campaign recommendations", e);
      return res.status(500).json({ error: "Failed to apply optimization recommendations to campaign." });
    }
  }

  // 2. Otherwise: Generate full optimization package
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "AI generation is not configured. Add OPENAI_API_KEY to your environment." });
  }

  try {
    const result = await analyzeCampaignPerformance({
      workspaceId,
      campaignId,
      useBrandVoice
    });
    return res.json(result);
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ error: e.message || "Campaign not found" });
    }
    return handleAIError(e, res);
  }
});

export default router;
