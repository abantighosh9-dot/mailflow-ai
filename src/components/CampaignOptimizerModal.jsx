import { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  X,
  TrendingUp,
  Check,
  Copy,
  AlertCircle,
  Clock,
  Users,
  Target,
  FileText,
  MousePointer,
  Info,
  RefreshCw,
  Layers,
  ArrowRight,
  ShieldCheck,
  CheckCircle2
} from "lucide-react";
import { api } from "../lib/api";

export default function CampaignOptimizerModal({
  campaignId,
  initialCampaign,
  onClose,
  onCampaignUpdated,
  writable = true
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [useBrandVoice, setUseBrandVoice] = useState(true);
  const [activeTab, setActiveTab] = useState("subject");

  // Copy feedback state { [key: string]: boolean }
  const [copiedKey, setCopiedKey] = useState(null);

  // Confirmation dialog state: null | { type, label, field, oldValue, newValue, applyPayload }
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [applying, setApplying] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = msg => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadAnalysis = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api(`/ai/analyze-campaign/${campaignId}`, {
        method: "POST",
        body: JSON.stringify({ useBrandVoice })
      });
      setData(res);
    } catch (err) {
      console.error("Failed to run AI campaign analysis:", err);
      setError(err?.message || "Failed to analyze campaign performance. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [campaignId, useBrandVoice]);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  const handleCopy = (text, key) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    showToast("Copied to clipboard!");
    setTimeout(() => {
      setCopiedKey(current => (current === key ? null : current));
    }, 2000);
  };

  const handleCopyAll = () => {
    if (!data?.recommendations) return;
    const recs = data.recommendations;
    const metrics = data.measuredMetrics || {};

    let report = `=== MAILFLOW AI CAMPAIGN OPTIMIZATION REPORT ===\n`;
    report += `Campaign: ${data.campaign?.name || "Untitled"}\n`;
    report += `Status: ${data.campaign?.status}\n`;
    report += `Measured: Sent: ${metrics.submitted || 0} | Delivered: ${metrics.delivered || 0} | Open Rate: ${metrics.openRate || 0}% | Click Rate: ${metrics.clickRate || 0}%\n\n`;

    report += `--- SUBJECT LINE RECOMMENDATIONS ---\n`;
    recs.subjectRecommendations?.forEach((s, i) => {
      report += `${i + 1}. [${s.style}] "${s.suggestion}"\n   Rationale: ${s.rationale}\n`;
    });

    report += `\n--- PREVIEW TEXT RECOMMENDATIONS ---\n`;
    recs.previewTextRecommendations?.forEach((p, i) => {
      report += `${i + 1}. "${p.suggestion}"\n   Rationale: ${p.rationale}\n`;
    });

    report += `\n--- CONTENT & COPY IMPROVEMENTS ---\n`;
    recs.contentRecommendations?.forEach((c, i) => {
      report += `${i + 1}. [${c.section}]\n   Critique: ${c.critique}\n   Suggested: ${c.suggestedChange}\n   Rationale: ${c.rationale}\n`;
    });

    report += `\n--- CTA RECOMMENDATIONS ---\n`;
    recs.ctaRecommendations?.forEach((cta, i) => {
      report += `${i + 1}. Suggested: "${cta.suggestedCta}" (Current: "${cta.currentCta || "None"}")\n   Tip: ${cta.placementTip}\n   Rationale: ${cta.rationale}\n`;
    });

    report += `\n--- SEND-TIME RECOMMENDATIONS ---\n`;
    report += `Recommended: ${recs.timingRecommendations?.recommendedDay} around ${recs.timingRecommendations?.recommendedTimeWindow}\n`;
    report += `Based on: ${recs.timingRecommendations?.basedOnHistoricalData ? "Historical Workspace Data" : "Industry Standard Heuristics"}\n`;
    report += `Rationale: ${recs.timingRecommendations?.rationale}\n\n`;

    report += `Disclaimer: ${recs.disclaimer}\n`;

    handleCopy(report, "all_report");
  };

  const requestApply = (type, label, field, oldValue, newValue, extraPayload = {}) => {
    if (!writable) {
      showToast("Your role does not have permission to modify campaigns.");
      return;
    }
    const isDraft = data?.campaign?.status === "DRAFT";
    setPendingConfirm({
      type,
      label,
      field,
      oldValue,
      newValue,
      isDraft,
      applyPayload: {
        [field]: newValue,
        ...extraPayload
      }
    });
  };

  const confirmApply = async () => {
    if (!pendingConfirm) return;
    setApplying(true);
    try {
      const isDraft = pendingConfirm.isDraft;
      const payload = {
        action: "apply_recommendations",
        useBrandVoice,
        applyChanges: {
          ...pendingConfirm.applyPayload,
          duplicateAsDraftIfSent: !isDraft
        }
      };

      const res = await api(`/ai/optimize-campaign/${campaignId}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (res.duplicated) {
        showToast(`Created new optimized draft: "${res.campaign.name}"`);
        if (onCampaignUpdated) onCampaignUpdated(res.campaign, true);
      } else {
        showToast("Campaign updated with approved recommendations!");
        // Update local campaign data
        setData(prev => ({
          ...prev,
          campaign: {
            ...prev.campaign,
            ...pendingConfirm.applyPayload
          }
        }));
        if (onCampaignUpdated) onCampaignUpdated(res.campaign, false);
      }
      setPendingConfirm(null);
    } catch (err) {
      console.error("Failed to apply optimization:", err);
      showToast(err?.message || "Failed to apply optimization changes.");
    } finally {
      setApplying(false);
    }
  };

  const campaign = data?.campaign || initialCampaign || {};
  const metrics = data?.measuredMetrics || {};
  const dataQuality = data?.dataQuality || {};
  const recs = data?.recommendations || {};

  return (
    <div className="modal-backdrop">
      <div className="modal optimizer-modal" role="dialog" aria-modal="true">
        {/* MODAL HEADER */}
        <div className="optimizer-header">
          <div className="optimizer-header-title">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "#f0edfc",
                color: "#6545bc",
                display: "grid",
                placeItems: "center"
              }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2>AI Campaign Performance Optimizer</h2>
                <span className={`status ${campaign.status === "SENT" ? "good" : "draft"}`}>
                  {campaign.status || "DRAFT"}
                </span>
                {data?.appliedBrandVoice && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#6545bc",
                      background: "#f0edfc",
                      padding: "2px 8px",
                      borderRadius: 12
                    }}
                  >
                    ★ Brand Voice
                  </span>
                )}
              </div>
              <p style={{ fontSize: 11, color: "#8b91a3", margin: "2px 0 0" }}>
                Campaign: <b>{campaign.name || "Untitled"}</b>
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                cursor: "pointer",
                userSelect: "none"
              }}
              title="Apply workspace tone, persona, and prohibited words"
            >
              <input
                type="checkbox"
                checked={useBrandVoice}
                onChange={e => setUseBrandVoice(e.target.checked)}
              />
              <span style={{ fontWeight: 600, color: "#475569" }}>Brand Voice</span>
            </label>

            <button
              className="soft-button"
              onClick={loadAnalysis}
              disabled={loading}
              title="Refresh AI Analysis"
              style={{ padding: "6px 10px" }}
            >
              <RefreshCw size={13} className={loading ? "spin" : ""} />
            </button>

            <button className="icon-button" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* MODAL BODY */}
        <div className="optimizer-body">
          {/* TOAST NOTIFICATION */}
          {toastMessage && (
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 10,
                background: "#20243a",
                color: "#fff",
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
              }}
            >
              <span>{toastMessage}</span>
              <button
                onClick={() => setToastMessage(null)}
                style={{ background: "none", border: 0, color: "#fff", padding: 0 }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* LOADING STATE */}
          {loading && !data && (
            <div
              style={{
                padding: "60px 20px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 14,
                textAlign: "center"
              }}
            >
              <div
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 16,
                  background: "#f0edfc",
                  color: "#6545bc",
                  display: "grid",
                  placeItems: "center"
                }}
              >
                <Sparkles size={24} className="spin" />
              </div>
              <h3 style={{ fontSize: 16 }}>Running AI Campaign Performance Diagnostics…</h3>
              <p className="muted" style={{ maxWidth: 440, fontSize: 12 }}>
                Evaluating delivery rates, subject line readability, audience targeting alignment, and workspace historical sending patterns.
              </p>
            </div>
          )}

          {/* ERROR STATE */}
          {error && !loading && (
            <div className="error-box" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <AlertCircle size={20} />
                <div style={{ flex: 1 }}>
                  <b>Failed to generate campaign optimization</b>
                  <p style={{ margin: "4px 0 0", fontSize: 11 }}>{error}</p>
                </div>
                <button className="primary-button" onClick={loadAnalysis} style={{ padding: "6px 12px" }}>
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* LOADED CONTENT */}
          {data && (
            <>
              {/* 1. MEASURED PERFORMANCE VS AI RECOMMENDATIONS DISTINCTION */}
              <div className="optimizer-source-banner">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ShieldCheck size={18} />
                  <div>
                    <span className="optimizer-source-tag">Source of Truth & Data Integrity</span>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                      Measured analytics reflect verified server-side deliveries. Strategic recommendations are generated via AI copywriting heuristics.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="soft-button"
                  onClick={handleCopyAll}
                  style={{ background: "#fff", fontSize: 11, padding: "5px 10px" }}
                >
                  {copiedKey === "all_report" ? <Check size={13} color="#16a34a" /> : <Copy size={13} />}
                  Copy Full Report
                </button>
              </div>

              {/* 2. MEASURED PERFORMANCE METRICS CARD */}
              <div className="optimizer-metrics-grid">
                <div className="optimizer-metric-card">
                  <span className="optimizer-metric-label">Targeted / Sent</span>
                  <div className="optimizer-metric-val">{metrics.submitted?.toLocaleString() || 0}</div>
                  <span className="optimizer-metric-sub">
                    {metrics.delivered > 0 ? `${metrics.deliveryRate}% delivered` : "Pending delivery"}
                  </span>
                </div>

                <div className="optimizer-metric-card">
                  <span className="optimizer-metric-label">Open Rate</span>
                  <div className="optimizer-metric-val" style={{ color: metrics.openRate > 20 ? "#16a34a" : "#20243a" }}>
                    {metrics.openRate}%
                  </div>
                  <span className="optimizer-metric-sub">
                    {metrics.opened?.toLocaleString() || 0} unique opens
                  </span>
                </div>

                <div className="optimizer-metric-card">
                  <span className="optimizer-metric-label">Click Rate</span>
                  <div className="optimizer-metric-val" style={{ color: metrics.clickRate > 3 ? "#6545bc" : "#20243a" }}>
                    {metrics.clickRate}%
                  </div>
                  <span className="optimizer-metric-sub">
                    {metrics.clicked?.toLocaleString() || 0} unique clicks
                  </span>
                </div>

                <div className="optimizer-metric-card">
                  <span className="optimizer-metric-label">Bounce Rate</span>
                  <div className="optimizer-metric-val" style={{ color: metrics.bounceRate > 5 ? "#dc2626" : "#20243a" }}>
                    {metrics.bounceRate}%
                  </div>
                  <span className="optimizer-metric-sub">
                    {metrics.bounced?.toLocaleString() || 0} bounced
                  </span>
                </div>
              </div>

              {/* 3. DATA SUFFICIENCY BANNER */}
              {!dataQuality.hasSufficientData && (
                <div
                  style={{
                    background: "#f0f9ff",
                    border: "1px solid #bae6fd",
                    color: "#0369a1",
                    padding: "12px 16px",
                    borderRadius: 10,
                    fontSize: 11,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10
                  }}
                >
                  <Info size={16} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <b>Heuristic-Based Analysis (Unsent / Draft Campaign)</b>
                    <div style={{ marginTop: 2, lineHeight: 1.5 }}>
                      {dataQuality.insufficientDataReason} Recommendations below focus on copywriting heuristics, inbox preview optimization, and audience segment alignment.
                    </div>
                  </div>
                </div>
              )}

              {/* 4. OVERALL DIAGNOSTIC EXPLANATION */}
              {recs.overallExplanation && (
                <div
                  style={{
                    background: "#fafbfe",
                    border: "1px solid #edf0f7",
                    borderRadius: 10,
                    padding: "14px 16px",
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: "#334155"
                  }}
                >
                  <b style={{ color: "#0f172a", display: "block", marginBottom: 4 }}>
                    Executive Diagnostic Summary
                  </b>
                  {recs.overallExplanation}
                </div>
              )}

              {/* 5. CATEGORY NAVIGATION TABS */}
              <div className="optimizer-tabs">
                <button
                  type="button"
                  className={`optimizer-tab-btn ${activeTab === "subject" ? "active" : ""}`}
                  onClick={() => setActiveTab("subject")}
                >
                  <Target size={14} /> Subject & Preview Text
                </button>
                <button
                  type="button"
                  className={`optimizer-tab-btn ${activeTab === "content" ? "active" : ""}`}
                  onClick={() => setActiveTab("content")}
                >
                  <FileText size={14} /> Content & Copywriting
                </button>
                <button
                  type="button"
                  className={`optimizer-tab-btn ${activeTab === "cta" ? "active" : ""}`}
                  onClick={() => setActiveTab("cta")}
                >
                  <MousePointer size={14} /> Call-to-Action (CTA)
                </button>
                <button
                  type="button"
                  className={`optimizer-tab-btn ${activeTab === "audience" ? "active" : ""}`}
                  onClick={() => setActiveTab("audience")}
                >
                  <Users size={14} /> Audience Targeting
                </button>
                <button
                  type="button"
                  className={`optimizer-tab-btn ${activeTab === "timing" ? "active" : ""}`}
                  onClick={() => setActiveTab("timing")}
                >
                  <Clock size={14} /> Send-Time Timing
                </button>
              </div>

              {/* TAB 1: SUBJECT & PREVIEW TEXT */}
              {activeTab === "subject" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Current Subject & Preview */}
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "12px 16px",
                      fontSize: 11
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <span className="muted" style={{ display: "block", fontSize: 10, fontWeight: 700 }}>
                          CURRENT SUBJECT LINE
                        </span>
                        <b style={{ fontSize: 12, color: "#1e293b" }}>{campaign.subject || "(Empty)"}</b>
                      </div>
                      <div>
                        <span className="muted" style={{ display: "block", fontSize: 10, fontWeight: 700 }}>
                          CURRENT PREVIEW TEXT
                        </span>
                        <span style={{ fontSize: 12, color: "#475569" }}>
                          {campaign.previewText || "(None set)"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Subject Line Recommendations */}
                  <h4 style={{ fontSize: 13, margin: "6px 0 0" }}>Suggested Subject Line Variations</h4>
                  {recs.subjectRecommendations?.map((s, idx) => (
                    <div key={idx} className="optimizer-rec-card">
                      <div className="optimizer-rec-header">
                        <span className="optimizer-rec-badge">{s.style || "Alternative"}</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className="soft-button"
                            style={{ padding: "4px 8px", fontSize: 10 }}
                            onClick={() => handleCopy(s.suggestion, `sub_${idx}`)}
                          >
                            {copiedKey === `sub_${idx}` ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                            Copy
                          </button>
                          {writable && (
                            <button
                              type="button"
                              className="primary-button"
                              style={{ padding: "4px 10px", fontSize: 10 }}
                              onClick={() =>
                                requestApply(
                                  "subject",
                                  "Subject Line",
                                  "subject",
                                  campaign.subject,
                                  s.suggestion
                                )
                              }
                            >
                              Apply Subject
                            </button>
                          )}
                        </div>
                      </div>

                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                        "{s.suggestion}"
                      </div>

                      <div className="optimizer-rationale">
                        <b>Rationale:</b> {s.rationale}
                      </div>
                    </div>
                  ))}

                  {/* Preview Text Recommendations */}
                  <h4 style={{ fontSize: 13, margin: "14px 0 0" }}>Suggested Preview Text Options</h4>
                  {recs.previewTextRecommendations?.map((p, idx) => (
                    <div key={idx} className="optimizer-rec-card">
                      <div className="optimizer-rec-header">
                        <span className="optimizer-rec-badge" style={{ background: "#e0f2fe", color: "#0369a1" }}>
                          Inbox Preheader
                        </span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className="soft-button"
                            style={{ padding: "4px 8px", fontSize: 10 }}
                            onClick={() => handleCopy(p.suggestion, `pre_${idx}`)}
                          >
                            {copiedKey === `pre_${idx}` ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                            Copy
                          </button>
                          {writable && (
                            <button
                              type="button"
                              className="primary-button"
                              style={{ padding: "4px 10px", fontSize: 10 }}
                              onClick={() =>
                                requestApply(
                                  "previewText",
                                  "Preview Text",
                                  "previewText",
                                  campaign.previewText,
                                  p.suggestion
                                )
                              }
                            >
                              Apply Preview Text
                            </button>
                          )}
                        </div>
                      </div>

                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>
                        "{p.suggestion}"
                      </div>

                      <div className="optimizer-rationale">
                        <b>Rationale:</b> {p.rationale}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 2: CONTENT & COPYWRITING */}
              {activeTab === "content" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {recs.contentRecommendations?.length === 0 ? (
                    <p className="muted" style={{ padding: 20, textAlign: "center" }}>
                      No content critiques for this campaign.
                    </p>
                  ) : (
                    recs.contentRecommendations?.map((c, idx) => (
                      <div key={idx} className="optimizer-rec-card">
                        <div className="optimizer-rec-header">
                          <span className="optimizer-rec-badge" style={{ background: "#fef3c7", color: "#92400e" }}>
                            {c.section || "Body Content"}
                          </span>
                          <button
                            type="button"
                            className="soft-button"
                            style={{ padding: "4px 8px", fontSize: 10 }}
                            onClick={() => handleCopy(c.suggestedChange, `cnt_${idx}`)}
                          >
                            {copiedKey === `cnt_${idx}` ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                            Copy Suggestion
                          </button>
                        </div>

                        <div>
                          <div style={{ fontSize: 11, color: "#b91c1c", fontWeight: 600, marginBottom: 4 }}>
                            Critique:
                          </div>
                          <p style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>{c.critique}</p>
                        </div>

                        <div style={{ background: "#f8fafc", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                          <div style={{ fontSize: 11, color: "#166534", fontWeight: 700, marginBottom: 4 }}>
                            Suggested Revision:
                          </div>
                          <div style={{ fontSize: 12, color: "#1e293b", lineHeight: 1.6 }}>
                            {c.suggestedChange}
                          </div>
                        </div>

                        <div className="optimizer-rationale">
                          <b>Rationale:</b> {c.rationale}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 3: CALL-TO-ACTION (CTA) */}
              {activeTab === "cta" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {recs.ctaRecommendations?.map((cta, idx) => (
                    <div key={idx} className="optimizer-rec-card">
                      <div className="optimizer-rec-header">
                        <span className="optimizer-rec-badge" style={{ background: "#ecfdf5", color: "#065f46" }}>
                          Call-to-Action Optimization
                        </span>
                        <button
                          type="button"
                          className="soft-button"
                          style={{ padding: "4px 8px", fontSize: 10 }}
                          onClick={() => handleCopy(cta.suggestedCta, `cta_${idx}`)}
                        >
                          {copiedKey === `cta_${idx}` ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                          Copy CTA
                        </button>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div style={{ background: "#f8fafc", padding: "10px 12px", borderRadius: 8 }}>
                          <span className="muted" style={{ display: "block", fontSize: 10, fontWeight: 700 }}>
                            CURRENT CTA
                          </span>
                          <b style={{ fontSize: 13, color: "#64748b" }}>{cta.currentCta || "Generic Link"}</b>
                        </div>
                        <div style={{ background: "#f0edfc", padding: "10px 12px", borderRadius: 8 }}>
                          <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#6545bc" }}>
                            SUGGESTED HIGH-CONVERTING CTA
                          </span>
                          <b style={{ fontSize: 13, color: "#6545bc" }}>{cta.suggestedCta}</b>
                        </div>
                      </div>

                      {cta.placementTip && (
                        <div style={{ fontSize: 11, color: "#334155" }}>
                          <b>Placement & Presentation:</b> {cta.placementTip}
                        </div>
                      )}

                      <div className="optimizer-rationale">
                        <b>Rationale:</b> {cta.rationale}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 4: AUDIENCE TARGETING */}
              {activeTab === "audience" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "12px 16px",
                      fontSize: 11
                    }}
                  >
                    <span className="muted" style={{ display: "block", fontSize: 10, fontWeight: 700 }}>
                      CURRENT CAMPAIGN TARGETING
                    </span>
                    <b style={{ fontSize: 12, color: "#1e293b" }}>
                      {(campaign.targetTags || []).length > 0
                        ? `Tags: ${campaign.targetTags.join(", ")}`
                        : "All Subscribed Contacts (Broad Broadcast)"}
                    </b>
                  </div>

                  {recs.audienceRecommendations?.map((a, idx) => (
                    <div key={idx} className="optimizer-rec-card">
                      <div className="optimizer-rec-header">
                        <span className="optimizer-rec-badge" style={{ background: "#fdf4ff", color: "#86198f" }}>
                          Audience Segmentation
                        </span>
                        {writable && a.suggestedTags?.length > 0 && (
                          <button
                            type="button"
                            className="primary-button"
                            style={{ padding: "4px 10px", fontSize: 10 }}
                            onClick={() =>
                              requestApply(
                                "tags",
                                "Target Audience Tags",
                                "targetTags",
                                (campaign.targetTags || []).join(", "),
                                a.suggestedTags
                              )
                            }
                          >
                            Apply Suggested Tags
                          </button>
                        )}
                      </div>

                      <p style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", margin: 0 }}>
                        {a.segmentTip}
                      </p>

                      {a.suggestedTags?.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, color: "#64748b" }}>Recommended Tags:</span>
                          {a.suggestedTags.map(tag => (
                            <span
                              key={tag}
                              style={{
                                background: "#f3e8ff",
                                color: "#6b21a8",
                                padding: "2px 8px",
                                borderRadius: 12,
                                fontSize: 11,
                                fontWeight: 700
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="optimizer-rationale">
                        <b>Rationale:</b> {a.rationale}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 5: SEND-TIME TIMING */}
              {activeTab === "timing" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div className="optimizer-rec-card">
                    <div className="optimizer-rec-header">
                      <span
                        className="optimizer-rec-badge"
                        style={{
                          background: recs.timingRecommendations?.basedOnHistoricalData ? "#ecfdf5" : "#f1f5f9",
                          color: recs.timingRecommendations?.basedOnHistoricalData ? "#065f46" : "#475569"
                        }}
                      >
                        {recs.timingRecommendations?.basedOnHistoricalData
                          ? "✓ Verified Workspace Historical Patterns"
                          : "Baseline Industry Timing (Fewer than 3 sends)"}
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ background: "#f8fafc", padding: "12px", borderRadius: 8 }}>
                        <span className="muted" style={{ display: "block", fontSize: 10, fontWeight: 700 }}>
                          RECOMMENDED DISPATCH DAY
                        </span>
                        <b style={{ fontSize: 16, color: "#0f172a" }}>
                          {recs.timingRecommendations?.recommendedDay || "Tuesday"}
                        </b>
                      </div>
                      <div style={{ background: "#f8fafc", padding: "12px", borderRadius: 8 }}>
                        <span className="muted" style={{ display: "block", fontSize: 10, fontWeight: 700 }}>
                          OPTIMAL SEND WINDOW
                        </span>
                        <b style={{ fontSize: 16, color: "#0f172a" }}>
                          {recs.timingRecommendations?.recommendedTimeWindow || "9:30 AM – 11:30 AM"}
                        </b>
                      </div>
                    </div>

                    {recs.timingRecommendations?.timezoneTip && (
                      <div style={{ fontSize: 11, color: "#334155" }}>
                        <b>Timezone Strategy:</b> {recs.timingRecommendations.timezoneTip}
                      </div>
                    )}

                    <div className="optimizer-rationale">
                      <b>Timing Logic:</b> {recs.timingRecommendations?.rationale}
                    </div>
                  </div>
                </div>
              )}

              {/* 6. COMPLIANCE & LEGAL DISCLAIMER */}
              <div className="optimizer-disclaimer">
                {recs.disclaimer ||
                  "AI recommendations are predictive heuristics and copywriting suggestions based on aggregate email marketing models. They do not guarantee specific delivery, open, or click rates."}
              </div>
            </>
          )}
        </div>

        {/* CONFIRMATION OVERWRITE / DUPLICATION MODAL */}
        {pendingConfirm && (
          <div className="confirm-dialog-backdrop">
            <div className="confirm-dialog" role="dialog" aria-modal="true">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "#f0edfc",
                    color: "#6545bc",
                    display: "grid",
                    placeItems: "center"
                  }}
                >
                  <Sparkles size={16} />
                </div>
                <h3 style={{ fontSize: 16, margin: 0 }}>
                  {pendingConfirm.isDraft ? "Apply Optimization to Draft" : "Duplicate as Optimized Draft"}
                </h3>
              </div>

              <p style={{ fontSize: 12, color: "#475569", lineHeight: 1.5, margin: "0 0 14px" }}>
                {pendingConfirm.isDraft ? (
                  <>
                    Are you sure you want to update this draft's{" "}
                    <b>{pendingConfirm.label}</b>?
                  </>
                ) : (
                  <>
                    This campaign has already been dispatched (<b>{campaign.status}</b>) and cannot be modified directly.
                    Would you like to <b>duplicate this campaign as a new editable draft</b> with the selected recommendation pre-applied?
                  </>
                )}
              </p>

              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: 10,
                  fontSize: 11,
                  marginBottom: 16
                }}
              >
                <div style={{ marginBottom: 6 }}>
                  <span className="muted">Field:</span> <b>{pendingConfirm.label}</b>
                </div>
                {pendingConfirm.oldValue && (
                  <div style={{ color: "#b91c1c", marginBottom: 4 }}>
                    <span className="muted">Current:</span> "{String(pendingConfirm.oldValue)}"
                  </div>
                )}
                <div style={{ color: "#166534" }}>
                  <span className="muted">New Value:</span> "
                  {Array.isArray(pendingConfirm.newValue)
                    ? pendingConfirm.newValue.join(", ")
                    : String(pendingConfirm.newValue)}
                  "
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  className="soft-button"
                  onClick={() => setPendingConfirm(null)}
                  disabled={applying}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={confirmApply}
                  disabled={applying}
                >
                  {applying ? "Applying…" : pendingConfirm.isDraft ? "Yes, Apply Change" : "Create Optimized Draft"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
