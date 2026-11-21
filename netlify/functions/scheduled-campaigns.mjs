// Netlify Scheduled Function — Automatic Campaign & Workflow Processor
// Runs every minute in Netlify to detect and process due campaigns and workflows without browser open
import { schedule } from "@netlify/functions";
import { processDueCampaigns } from "./_lib/campaign-runner.mjs";
import { processDueWorkflows } from "./_lib/workflow-runner.mjs";

export const handler = schedule("* * * * *", async () => {
  try {
    const [campaignsResult, workflowsResult] = await Promise.all([
      processDueCampaigns().catch(e => ({ error: e.message })),
      processDueWorkflows().catch(e => ({ error: e.message }))
    ]);
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        success: true,
        campaigns: campaignsResult,
        workflows: workflowsResult,
        timestamp: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error("Scheduled background processor error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Scheduled processor failure" })
    };
  }
});
