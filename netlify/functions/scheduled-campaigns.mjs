// Netlify Scheduled Function — Automatic Campaign Processor
// Runs every minute in Netlify to detect and process due campaigns without browser open
import { schedule } from "@netlify/functions";
import { processDueCampaigns } from "./_lib/campaign-runner.mjs";

export const handler = schedule("* * * * *", async () => {
  try {
    const result = await processDueCampaigns();
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        success: true,
        ...result,
        timestamp: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error("Scheduled campaign processor error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Scheduled processor failure" })
    };
  }
});
