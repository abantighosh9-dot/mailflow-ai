import { prisma } from "./db.mjs";
import {
  getOpenAIClient,
  buildBrandVoiceContext,
  scrubProhibitedPhrases
} from "./ai-email.mjs";

export const DISCLAIMER_TEXT =
  "AI recommendations are predictive heuristics and copywriting suggestions based on aggregate email marketing models. They do not guarantee specific delivery, open, or click rates.";

/**
 * Strips HTML tags and excessive whitespace to produce clean text for prompt evaluation.
 */
export function extractCleanContentFromHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

/**
 * Extracts links and button texts from HTML to detect current CTAs.
 */
export function extractCtasFromHtml(html) {
  if (!html || typeof html !== "string") return [];
  const ctas = [];
  const regex = /<a[^>]*>(.*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, "").trim();
    if (text && !/unsubscribe|privacy|terms|view in browser/i.test(text) && text.length < 80) {
      ctas.push(text);
    }
  }
  return [...new Set(ctas)].slice(0, 5);
}

/**
 * Calculates delivery and engagement percentage rates.
 */
export function calculateCampaignRates(campaign) {
  const submitted = Number(campaign.sendSucceeded || 0);
  const delivered = Number(campaign.deliveredCount || 0);
  const opened = Number(campaign.openedCount || 0);
  const clicked = Number(campaign.clickedCount || 0);
  const bounced = Number(campaign.bouncedCount || 0);

  const deliveryRate = submitted > 0
    ? Math.min(Math.round((delivered / submitted) * 10000) / 100, 100)
    : 0;
  const openRate = delivered > 0
    ? Math.min(Math.round((opened / delivered) * 10000) / 100, 100)
    : 0;
  const clickRate = delivered > 0
    ? Math.min(Math.round((clicked / delivered) * 10000) / 100, 100)
    : 0;
  const bounceRate = submitted > 0
    ? Math.min(Math.round((bounced / submitted) * 10000) / 100, 100)
    : 0;

  return {
    submitted,
    delivered,
    opened,
    clicked,
    bounced,
    failed: Number(campaign.sendFailed || 0),
    deliveryRate,
    openRate,
    clickRate,
    bounceRate
  };
}

/**
 * Analyzes workspace historical sending patterns to evaluate send-time recommendations.
 */
export async function analyzeHistoricalSendTiming(workspaceId, currentCampaignId) {
  try {
    const pastCampaigns = await prisma.campaign.findMany({
      where: {
        workspaceId,
        id: { not: currentCampaignId },
        status: "SENT",
        sentAt: { not: null },
        deliveredCount: { gt: 0 }
      },
      select: {
        id: true,
        sentAt: true,
        deliveredCount: true,
        openedCount: true,
        clickedCount: true
      },
      take: 50
    });

    const totalSent = pastCampaigns.length;
    if (totalSent < 3) {
      return {
        hasSendTimeData: false,
        totalSentCampaigns: totalSent,
        recommendedDay: "Tuesday",
        recommendedTimeWindow: "9:00 AM – 11:00 AM",
        timezoneTip: "Recipients' local standard time",
        historicalSummary: "Fewer than 3 completed campaigns with delivery data exist in this workspace. Baseline industry recommendations apply until more sends accumulate.",
        rationale: "Empirical workspace sending history is insufficient (minimum 3 sent campaigns required). Standard industry studies indicate mid-week mornings (Tuesday/Thursday 9:00 AM – 11:00 AM) achieve top baseline engagement."
      };
    }

    // Aggregate by day of week (0 = Sunday, 1 = Monday, ...)
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayStats = {};
    for (const c of pastCampaigns) {
      const d = new Date(c.sentAt);
      const dayName = days[d.getDay()];
      if (!dayStats[dayName]) {
        dayStats[dayName] = { totalDelivered: 0, totalOpened: 0, count: 0 };
      }
      dayStats[dayName].totalDelivered += c.deliveredCount;
      dayStats[dayName].totalOpened += c.openedCount;
      dayStats[dayName].count += 1;
    }

    let bestDay = "Tuesday";
    let highestOpenRate = -1;
    for (const [dayName, stats] of Object.entries(dayStats)) {
      if (stats.totalDelivered > 0) {
        const rate = (stats.totalOpened / stats.totalDelivered) * 100;
        if (rate > highestOpenRate) {
          highestOpenRate = rate;
          bestDay = dayName;
        }
      }
    }

    return {
      hasSendTimeData: true,
      totalSentCampaigns: totalSent,
      recommendedDay: bestDay,
      recommendedTimeWindow: "9:30 AM – 11:30 AM",
      timezoneTip: "Recipients' local standard time",
      historicalSummary: `Based on ${totalSent} past completed campaigns in this workspace, ${bestDay}s yielded the highest average open rate (~${Math.round(highestOpenRate)}%).`,
      rationale: `Historical workspace data shows higher open rates on ${bestDay}s across ${totalSent} past sends.`
    };
  } catch (err) {
    console.error("Error analyzing historical timing:", err);
    return {
      hasSendTimeData: false,
      totalSentCampaigns: 0,
      recommendedDay: "Tuesday",
      recommendedTimeWindow: "9:00 AM – 11:00 AM",
      timezoneTip: "Recipients' local standard time",
      historicalSummary: "Unable to calculate historical workspace patterns. Baseline recommendations apply.",
      rationale: "Defaulting to industry benchmark of Tuesday mid-morning."
    };
  }
}

/**
 * Builds the AI prompt for campaign performance diagnostic and optimization.
 */
export function buildOptimizationPrompt({
  campaign,
  measuredMetrics,
  dataQuality,
  historicalTiming,
  brandVoice,
  cleanContent,
  existingCtas
}) {
  const brandVoiceContext = buildBrandVoiceContext(brandVoice);

  const systemPrompt = `You are an expert email marketing performance strategist and copywriter.
Your role is to analyze email marketing campaigns and return actionable, high-impact recommendations to improve delivery, open rates, click-through rates, and audience conversion.

STRICT GUIDELINES:
1. Clearly distinguish measured historical performance from AI recommendations.
2. If the campaign has insufficient historical data (${dataQuality.hasSufficientData ? "Data IS sufficient" : "Data IS INSUFFICIENT"}), state clearly that suggestions are based on copywriting heuristics, subject clarity, and structural best practices rather than past metrics.
3. For send-time recommendations: ${historicalTiming.hasSendTimeData ? "Historical data exists: " + historicalTiming.historicalSummary : "No sufficient historical data exists: state this honestly and offer industry benchmark guidelines."}
4. Never promise or guarantee improved metrics. Frame recommendations as probabilistic suggestions.
5. Provide a concise, logical rationale for every single suggestion.
6. Provide distinct subject line variations:
   - "Curiosity & Intrigue"
   - "Direct Benefit & Value"
   - "Urgency & Timeliness"
7. Strictly respect the workspace brand voice, tone, and forbidden words.
8. Output MUST be valid JSON adhering to the specified format.`;

  const userPrompt = `Please analyze the following campaign performance data and draft content:

${brandVoiceContext}

--- CAMPAIGN METADATA ---
Campaign Name: ${campaign.name}
Status: ${campaign.status}
Subject: ${campaign.subject || "(None)"}
Preview Text: ${campaign.previewText || "(None)"}
Description/Goal: ${campaign.description || "(None)"}
Target Audience Tags: ${(campaign.targetTags || []).length > 0 ? campaign.targetTags.join(", ") : "All subscribed contacts"}
Detected CTAs: ${existingCtas.length > 0 ? existingCtas.join(", ") : "None detected"}

--- MEASURED PERFORMANCE METRICS ---
- Has Empirical Data: ${dataQuality.hasSufficientData ? "YES" : "NO (" + dataQuality.insufficientDataReason + ")"}
- Targeted Recipients: ${campaign.sendTotal || 0}
- Sent / Submitted: ${measuredMetrics.submitted}
- Delivered: ${measuredMetrics.delivered}
- Delivery Rate: ${measuredMetrics.deliveryRate}%
- Opened: ${measuredMetrics.opened}
- Open Rate: ${measuredMetrics.openRate}%
- Clicked: ${measuredMetrics.clicked}
- Click Rate: ${measuredMetrics.clickRate}%
- Bounced: ${measuredMetrics.bounced}
- Bounce Rate: ${measuredMetrics.bounceRate}%
- Failed: ${measuredMetrics.failed}

--- HISTORICAL SEND TIMING DATA ---
- Sufficient Historical Sends: ${historicalTiming.hasSendTimeData ? "YES" : "NO"}
- Historical Summary: ${historicalTiming.historicalSummary}

--- EMAIL CONTENT SUMMARY (First 4000 characters) ---
${cleanContent || "(No body content provided yet)"}

Return a JSON object with this exact structure:
{
  "subjectRecommendations": [
    {
      "suggestion": "Compelling subject line",
      "style": "Direct Benefit / Curiosity / Urgency",
      "rationale": "Clear reason why this works better"
    }
  ],
  "previewTextRecommendations": [
    {
      "suggestion": "Complementary preview text snippet",
      "rationale": "How it reinforces the subject line"
    }
  ],
  "contentRecommendations": [
    {
      "section": "Headline / Hook / Body / Offer / Value Proposition",
      "critique": "What could be improved",
      "suggestedChange": "Concrete suggestion or rewrite",
      "rationale": "Why this change improves engagement"
    }
  ],
  "ctaRecommendations": [
    {
      "currentCta": "${existingCtas[0] || "Default Link"}",
      "suggestedCta": "Specific action-oriented button text",
      "placementTip": "Where and how to present the button",
      "rationale": "Why this improves click-through rate"
    }
  ],
  "audienceRecommendations": [
    {
      "segmentTip": "Audience segmentation suggestion",
      "suggestedTags": ["tag1", "tag2"],
      "rationale": "Why segmenting this way boosts relevance"
    }
  ],
  "timingRecommendations": {
    "recommendedDay": "${historicalTiming.recommendedDay}",
    "recommendedTimeWindow": "${historicalTiming.recommendedTimeWindow}",
    "timezoneTip": "${historicalTiming.timezoneTip}",
    "rationale": "${historicalTiming.rationale}",
    "basedOnHistoricalData": ${historicalTiming.hasSendTimeData}
  },
  "overallExplanation": "High-level summary of the diagnostic analysis and key opportunities."
}`;

  return { systemPrompt, userPrompt };
}

/**
 * Analyzes campaign and returns measured metrics + AI optimization suggestions.
 */
export async function analyzeCampaignPerformance({
  workspaceId,
  campaignId,
  useBrandVoice = true
}) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId }
  });

  if (!campaign) {
    const error = new Error("Campaign not found");
    error.status = 404;
    throw error;
  }

  // Calculate measured metrics
  const measuredMetrics = calculateCampaignRates(campaign);

  // Determine data sufficiency
  const hasSufficientData = campaign.status === "SENT" || (campaign.deliveredCount || 0) >= 5;
  const insufficientDataReason = !hasSufficientData
    ? campaign.status === "DRAFT"
      ? "Campaign is currently a draft and has not been dispatched to recipients."
      : "Campaign has fewer than 5 recorded deliveries to statistically establish patterns."
    : null;

  const dataQuality = {
    hasSufficientData,
    insufficientDataReason,
    isDraft: campaign.status === "DRAFT"
  };

  // Historical send timing from workspace
  const historicalTiming = await analyzeHistoricalSendTiming(workspaceId, campaignId);

  // Brand Voice
  let brandVoice = null;
  if (useBrandVoice) {
    brandVoice = await prisma.brandVoice.findUnique({
      where: { workspaceId }
    });
  }

  const cleanContent = extractCleanContentFromHtml(campaign.html);
  const existingCtas = extractCtasFromHtml(campaign.html);

  const { systemPrompt, userPrompt } = buildOptimizationPrompt({
    campaign,
    measuredMetrics,
    dataQuality,
    historicalTiming,
    brandVoice,
    cleanContent,
    existingCtas
  });

  const openai = getOpenAIClient();
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  let rawRecommendations = null;

  if (typeof openai.chat?.completions?.create === "function") {
    const res = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7
    });
    const text = res.choices?.[0]?.message?.content || "{}";
    rawRecommendations = JSON.parse(text);
  } else if (typeof openai.responses?.create === "function") {
    const res = await openai.responses.create({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });
    const text = res.output_text || res.choices?.[0]?.message?.content || "{}";
    rawRecommendations = JSON.parse(text);
  } else {
    throw new Error("OpenAI client missing completion method");
  }

  // Scrub prohibited phrases from all generated outputs if brand voice is configured
  const prohibitedPhrases = brandVoice?.prohibitedPhrases || [];
  const scrub = text => scrubProhibitedPhrases(text, prohibitedPhrases);

  const sanitizedRecommendations = {
    subjectRecommendations: (Array.isArray(rawRecommendations.subjectRecommendations)
      ? rawRecommendations.subjectRecommendations
      : []
    ).map(s => ({
      suggestion: scrub(s.suggestion || ""),
      style: s.style || "Optimized",
      rationale: scrub(s.rationale || "")
    })),
    previewTextRecommendations: (Array.isArray(rawRecommendations.previewTextRecommendations)
      ? rawRecommendations.previewTextRecommendations
      : []
    ).map(p => ({
      suggestion: scrub(p.suggestion || ""),
      rationale: scrub(p.rationale || "")
    })),
    contentRecommendations: (Array.isArray(rawRecommendations.contentRecommendations)
      ? rawRecommendations.contentRecommendations
      : []
    ).map(c => ({
      section: c.section || "Content",
      critique: scrub(c.critique || ""),
      suggestedChange: scrub(c.suggestedChange || ""),
      rationale: scrub(c.rationale || "")
    })),
    ctaRecommendations: (Array.isArray(rawRecommendations.ctaRecommendations)
      ? rawRecommendations.ctaRecommendations
      : []
    ).map(c => ({
      currentCta: c.currentCta || existingCtas[0] || "",
      suggestedCta: scrub(c.suggestedCta || ""),
      placementTip: scrub(c.placementTip || ""),
      rationale: scrub(c.rationale || "")
    })),
    audienceRecommendations: (Array.isArray(rawRecommendations.audienceRecommendations)
      ? rawRecommendations.audienceRecommendations
      : []
    ).map(a => ({
      segmentTip: scrub(a.segmentTip || ""),
      suggestedTags: Array.isArray(a.suggestedTags) ? a.suggestedTags.map(t => scrub(t)) : [],
      rationale: scrub(a.rationale || "")
    })),
    timingRecommendations: {
      recommendedDay: historicalTiming.hasSendTimeData
        ? historicalTiming.recommendedDay
        : (rawRecommendations.timingRecommendations?.recommendedDay || historicalTiming.recommendedDay),
      recommendedTimeWindow: historicalTiming.hasSendTimeData
        ? historicalTiming.recommendedTimeWindow
        : (rawRecommendations.timingRecommendations?.recommendedTimeWindow || historicalTiming.recommendedTimeWindow),
      timezoneTip: rawRecommendations.timingRecommendations?.timezoneTip || historicalTiming.timezoneTip,
      rationale: scrub(rawRecommendations.timingRecommendations?.rationale || historicalTiming.rationale),
      basedOnHistoricalData: Boolean(historicalTiming.hasSendTimeData)
    },
    overallExplanation: scrub(
      rawRecommendations.overallExplanation ||
        "Analysis completed. Focus on subject line curiosity and clear value proposition to elevate conversion."
    ),
    disclaimer: DISCLAIMER_TEXT
  };

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      subject: campaign.subject,
      previewText: campaign.previewText,
      status: campaign.status,
      targetTags: campaign.targetTags || [],
      sentAt: campaign.sentAt,
      createdAt: campaign.createdAt
    },
    measuredMetrics,
    dataQuality: {
      ...dataQuality,
      hasSendTimeData: historicalTiming.hasSendTimeData,
      totalSentCampaignsInWorkspace: historicalTiming.totalSentCampaigns
    },
    recommendations: sanitizedRecommendations,
    appliedBrandVoice: Boolean(brandVoice)
  };
}
