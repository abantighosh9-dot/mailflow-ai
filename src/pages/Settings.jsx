import { useState, useEffect } from "react";
import {
  Sparkles, Save, WandSparkles, RefreshCw, AlertCircle,
  Check, Globe, Shield, BookOpen, Ban, HelpCircle, ArrowRight,
  RotateCcw, Lock
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../state/AuthContext";

const TONE_OPTIONS = [
  "Professional", "Friendly", "Persuasive", "Conversational",
  "Formal", "Promotional", "Minimal", "Confident", "Inspiring", "Technical"
];

const LANGUAGE_OPTIONS = [
  "English", "Spanish", "French", "German", "Portuguese", "Italian", "Dutch"
];

export default function Settings() {
  const { user, workspace } = useAuth();
  const userRole = user?.role || workspace?.role || "OWNER";
  const canEdit = userRole === "OWNER" || userRole === "ADMIN";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Brand Voice Form State
  const [brandName, setBrandName] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [industry, setIndustry] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [preferredTone, setPreferredTone] = useState("Professional");
  const [brandPersonality, setBrandPersonality] = useState("");
  const [preferredVocabulary, setPreferredVocabulary] = useState("");
  const [prohibitedPhrases, setProhibitedPhrases] = useState("");
  const [styleGuidelines, setStyleGuidelines] = useState("");
  const [defaultLanguage, setDefaultLanguage] = useState("English");
  const [websiteUrl, setWebsiteUrl] = useState("");

  // Sample Analyzer State
  const [sampleText, setSampleText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState("");

  // Load brand voice settings on mount
  useEffect(() => {
    async function loadSettings() {
      setLoading(true);
      setError("");
      try {
        const data = await api("/ai/brand-voice");
        const bv = data?.brandVoice || {};
        setBrandName(bv.brandName || "");
        setBusinessDescription(bv.businessDescription || "");
        setIndustry(bv.industry || "");
        setTargetAudience(bv.targetAudience || "");
        setPreferredTone(bv.preferredTone || "Professional");
        setBrandPersonality(bv.brandPersonality || "");
        setPreferredVocabulary(Array.isArray(bv.preferredVocabulary) ? bv.preferredVocabulary.join(", ") : "");
        setProhibitedPhrases(Array.isArray(bv.prohibitedPhrases) ? bv.prohibitedPhrases.join(", ") : "");
        setStyleGuidelines(bv.styleGuidelines || "");
        setDefaultLanguage(bv.defaultLanguage || "English");
        setWebsiteUrl(bv.websiteUrl || "");
      } catch (err) {
        setError(err.message || "Failed to load brand voice settings.");
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  async function handleSave(e) {
    if (e) e.preventDefault();
    if (!canEdit) {
      setError("Only Workspace Owners and Admins can save brand voice settings.");
      return;
    }

    setSaving(true);
    setNotice("");
    setError("");

    try {
      const payload = {
        brandName: brandName.trim(),
        businessDescription: businessDescription.trim(),
        industry: industry.trim(),
        targetAudience: targetAudience.trim(),
        preferredTone,
        brandPersonality: brandPersonality.trim(),
        preferredVocabulary: preferredVocabulary.split(",").map(s => s.trim()).filter(Boolean),
        prohibitedPhrases: prohibitedPhrases.split(",").map(s => s.trim()).filter(Boolean),
        styleGuidelines: styleGuidelines.trim(),
        defaultLanguage,
        websiteUrl: websiteUrl.trim()
      };

      await api("/ai/brand-voice", {
        method: "PUT",
        body: JSON.stringify(payload)
      });

      setNotice("Brand voice settings saved successfully. New email campaigns and editor tools will automatically reflect these guidelines.");
      setTimeout(() => setNotice(""), 5000);
    } catch (err) {
      setError(err.message || "Failed to save brand voice settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!canEdit) return;
    if (!window.confirm("Are you sure you want to clear and reset all workspace brand voice settings to blank defaults? This cannot be undone.")) {
      return;
    }

    setResetting(true);
    setError("");
    setNotice("");

    try {
      const emptyPayload = {
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
      };

      await api("/ai/brand-voice", {
        method: "PUT",
        body: JSON.stringify(emptyPayload)
      });

      setBrandName("");
      setBusinessDescription("");
      setIndustry("");
      setTargetAudience("");
      setPreferredTone("Professional");
      setBrandPersonality("");
      setPreferredVocabulary("");
      setProhibitedPhrases("");
      setStyleGuidelines("");
      setDefaultLanguage("English");
      setWebsiteUrl("");

      setNotice("Brand voice settings have been cleared and reset to defaults.");
      setTimeout(() => setNotice(""), 5000);
    } catch (err) {
      setError(err.message || "Failed to reset brand voice settings.");
    } finally {
      setResetting(false);
    }
  }

  async function handleAnalyzeSample() {
    if (!sampleText.trim() || sampleText.trim().length < 20) {
      setAnalysisError("Please provide a writing sample of at least 20 characters.");
      return;
    }

    setAnalyzing(true);
    setAnalysisError("");
    try {
      const data = await api("/ai/brand-voice/analyze-sample", {
        method: "POST",
        body: JSON.stringify({ sample: sampleText.trim() })
      });
      setAnalysisResult(data.analysis);
    } catch (err) {
      setAnalysisError(err.message || "Failed to analyze writing sample.");
    } finally {
      setAnalyzing(false);
    }
  }

  function applyAnalysisInsights() {
    if (!analysisResult) return;
    if (analysisResult.detectedTone && TONE_OPTIONS.includes(analysisResult.detectedTone)) {
      setPreferredTone(analysisResult.detectedTone);
    }
    if (analysisResult.brandPersonality) {
      setBrandPersonality(analysisResult.brandPersonality);
    }
    if (Array.isArray(analysisResult.recommendedKeywords) && analysisResult.recommendedKeywords.length > 0) {
      const existing = preferredVocabulary ? preferredVocabulary.split(",").map(s => s.trim()).filter(Boolean) : [];
      const merged = Array.from(new Set([...existing, ...analysisResult.recommendedKeywords]));
      setPreferredVocabulary(merged.join(", "));
    }
    if (analysisResult.styleSummary) {
      setStyleGuidelines(prev => prev ? `${prev}\n\n${analysisResult.styleSummary}` : analysisResult.styleSummary);
    }
    setNotice("Applied AI writing analysis insights into brand voice settings!");
    setTimeout(() => setNotice(""), 4000);
  }

  if (loading) {
    return (
      <div className="page-stack">
        <div style={{ padding: "40px 0", textAlign: "center", color: "#7657d6" }}>
          <RefreshCw className="spin" size={24} style={{ margin: "auto", display: "block", marginBottom: "12px" }} />
          Loading workspace settings…
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div className="welcome-row">
        <div>
          <span className="form-kicker">WORKSPACE SETTINGS</span>
          <h1>
            AI Brand Voice & Identity <span className="ai-label"><Sparkles size={13} /> AI POWERED</span>
          </h1>
          <p className="muted">
            Configure your brand voice guidelines so generated emails, subject lines, and copy edits sound consistently like your company.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="chip" style={{ background: canEdit ? "#f0edfc" : "#f1f2f5", color: canEdit ? "#6545bc" : "#727787" }}>
            Role: <b>{userRole}</b>
          </span>
          {!canEdit && (
            <span style={{ fontSize: "11px", color: "#8a90a0", display: "flex", alignItems: "center", gap: "4px" }}>
              <Lock size={12} /> View-only access
            </span>
          )}
        </div>
      </div>

      {!canEdit && (
        <div style={{ background: "#fbf9fe", border: "1px solid #ebdcfc", color: "#6545bc", padding: "12px 18px", borderRadius: "8px", fontSize: "12px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
          <Lock size={16} />
          <span>
            <b>View-only mode:</b> You have permission to view workspace brand voice settings. Only Workspace <b>OWNER</b> and <b>ADMIN</b> roles can edit and save changes.
          </span>
        </div>
      )}

      {notice && (
        <div style={{ background: "#e9f8f1", color: "#269769", padding: "12px 18px", borderRadius: "8px", fontSize: "12px", fontWeight: "600", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
          <Check size={16} /> {notice}
        </div>
      )}

      {error && (
        <div className="error-box" style={{ marginBottom: "14px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "22px", alignItems: "start" }}>
        {/* BRAND VOICE FORM */}
        <form onSubmit={handleSave} className="panel prompt-panel" style={{ background: "#fff" }}>
          <div className="panel-heading" style={{ borderBottom: "1px solid #eceef4", paddingBottom: "14px", marginBottom: "18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Sparkles size={18} color="#6545bc" />
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "800" }}>Brand Guidelines</h3>
            </div>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: "11px" }}>
              These rules are injected into email draft generation, subject line ideation, and copy improvement.
            </p>
          </div>

          <div className="form-two">
            <label className="field-label">
              Brand Name *
              <input
                value={brandName}
                onChange={e => setBrandName(e.target.value)}
                placeholder="e.g. MailFlow AI"
                disabled={!canEdit}
                required
              />
            </label>
            <label className="field-label">
              Industry *
              <input
                value={industry}
                onChange={e => setIndustry(e.target.value)}
                placeholder="e.g. B2B SaaS, E-Commerce, Healthcare"
                disabled={!canEdit}
              />
            </label>
          </div>

          <label className="field-label">
            Business Description
            <textarea
              rows="3"
              value={businessDescription}
              onChange={e => setBusinessDescription(e.target.value)}
              placeholder="What does your company do, who does it help, and what makes it unique?"
              disabled={!canEdit}
            />
          </label>

          <label className="field-label">
            Target Audience Persona
            <input
              value={targetAudience}
              onChange={e => setTargetAudience(e.target.value)}
              placeholder="e.g. Marketing directors, startup founders, e-commerce managers"
              disabled={!canEdit}
            />
          </label>

          <div className="form-two">
            <label className="field-label">
              Default Writing Tone
              <select value={preferredTone} onChange={e => setPreferredTone(e.target.value)} disabled={!canEdit}>
                {TONE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field-label">
              Default Language
              <select value={defaultLanguage} onChange={e => setDefaultLanguage(e.target.value)} disabled={!canEdit}>
                {LANGUAGE_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          </div>

          <label className="field-label">
            Brand Personality Traits
            <input
              value={brandPersonality}
              onChange={e => setBrandPersonality(e.target.value)}
              placeholder="e.g. Visionary, empathetic, data-driven, approachable, playful"
              disabled={!canEdit}
            />
          </label>

          <label className="field-label">
            Preferred Vocabulary / Phrases
            <input
              value={preferredVocabulary}
              onChange={e => setPreferredVocabulary(e.target.value)}
              placeholder="e.g. frictionless, velocity, actionable, streamline (comma-separated)"
              disabled={!canEdit}
            />
            <small style={{ color: "#8a90a0", fontSize: "10px", marginTop: "4px" }}>
              Words or phrases you love that align with your product and positioning.
            </small>
          </label>

          <label className="field-label">
            Prohibited Phrases / Words to Avoid
            <input
              value={prohibitedPhrases}
              onChange={e => setProhibitedPhrases(e.target.value)}
              placeholder="e.g. cheap, guaranteed overnight, blast, spam, blast out (comma-separated)"
              disabled={!canEdit}
            />
            <small style={{ color: "#c34a4a", fontSize: "10px", marginTop: "4px" }}>
              Strictly prohibited from appearing in generated subjects, headlines, or email bodies.
            </small>
          </label>

          <label className="field-label">
            Style Guidelines & Formatting Rules
            <textarea
              rows="4"
              value={styleGuidelines}
              onChange={e => setStyleGuidelines(e.target.value)}
              placeholder="e.g. Use active voice; keep paragraphs under 3 sentences; use sentence case for headers; avoid exclamation points..."
              disabled={!canEdit}
            />
          </label>

          <label className="field-label">
            Company Website URL
            <input
              value={websiteUrl}
              onChange={e => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={!canEdit}
            />
          </label>

          {canEdit && (
            <div style={{ marginTop: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #eceef4", paddingTop: "16px" }}>
              <button
                type="button"
                className="soft-button"
                onClick={handleReset}
                disabled={resetting || saving}
                style={{ color: "#c34a4a", borderColor: "#f2d6d6" }}
              >
                {resetting ? <RefreshCw className="spin" size={13} /> : <RotateCcw size={13} />} Clear Settings
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={saving || resetting}
                style={{ padding: "10px 22px" }}
              >
                {saving ? <><RefreshCw className="spin" size={14} /> Saving…</> : <><Save size={14} /> Save Brand Voice</>}
              </button>
            </div>
          )}
        </form>

        {/* AI WRITING SAMPLE ANALYZER */}
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div className="panel prompt-panel" style={{ background: "#fff" }}>
            <div className="panel-heading" style={{ borderBottom: "1px solid #eceef4", paddingBottom: "14px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <WandSparkles size={18} color="#6545bc" />
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "800" }}>Tone & Style Analyzer</h3>
              </div>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: "11px" }}>
                Paste a representative marketing email, manifesto, or blog excerpt. AI will analyze tone, personality, and vocabulary.
              </p>
            </div>

            <label className="field-label">
              Sample Brand Writing *
              <textarea
                rows="6"
                value={sampleText}
                onChange={e => setSampleText(e.target.value)}
                placeholder="Paste your past email newsletter, product announcement, or company mission statement here..."
              />
            </label>

            <button
              type="button"
              className="primary-button full"
              onClick={handleAnalyzeSample}
              disabled={analyzing || !sampleText.trim() || sampleText.trim().length < 20}
              style={{ padding: "12px", justifyContent: "center" }}
            >
              {analyzing ? (
                <><RefreshCw className="spin" size={15} /> Analyzing Writing Style…</>
              ) : (
                <><WandSparkles size={15} /> Analyze Sample with AI <ArrowRight size={15} /></>
              )}
            </button>

            {analysisError && (
              <div className="error-box" style={{ marginTop: "12px" }}>
                {analysisError}
              </div>
            )}

            {analysisResult && (
              <div style={{ marginTop: "18px", padding: "16px", background: "#f8f9fe", borderRadius: "10px", border: "1px solid #eceef4" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <span style={{ fontSize: "10px", fontWeight: "800", color: "#6545bc", letterSpacing: "1px" }}>
                    AI ANALYSIS INSIGHTS
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className="soft-button"
                      style={{ padding: "4px 8px", fontSize: "11px" }}
                      onClick={applyAnalysisInsights}
                    >
                      <Check size={12} /> Apply to Form
                    </button>
                  )}
                </div>

                <div style={{ fontSize: "12px", marginBottom: "8px" }}>
                  <b>Detected Tone:</b> <span style={{ color: "#6545bc", fontWeight: "700" }}>{analysisResult.detectedTone}</span>
                </div>

                <div style={{ fontSize: "12px", marginBottom: "8px" }}>
                  <b>Personality Traits:</b> {analysisResult.brandPersonality}
                </div>

                {Array.isArray(analysisResult.recommendedKeywords) && analysisResult.recommendedKeywords.length > 0 && (
                  <div style={{ marginBottom: "10px" }}>
                    <b style={{ fontSize: "11px", display: "block", marginBottom: "4px" }}>Extracted Keywords:</b>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                      {analysisResult.recommendedKeywords.map((kw, i) => (
                        <span key={i} className="chip" style={{ padding: "2px 8px", fontSize: "10px", background: "#fff" }}>
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ fontSize: "11px", color: "#60677a", lineHeight: "1.5", marginTop: "8px" }}>
                  <b>Style Summary:</b> {analysisResult.styleSummary}
                </div>

                {analysisResult.recommendations && (
                  <div style={{ fontSize: "11px", color: "#60677a", lineHeight: "1.5", marginTop: "8px", borderTop: "1px dashed #e1e3ea", paddingTop: "8px" }}>
                    <b>Recommendations:</b> {analysisResult.recommendations}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Privacy & Safety Note */}
          <div className="tip-box" style={{ background: "#fdf8ee", color: "#9a6c1e", borderColor: "#f9e7c3" }}>
            <Shield size={18} />
            <span>
              <b>Privacy & Prompt Safety</b>
              <small style={{ color: "#7c5514" }}>
                Brand samples are processed in isolated prompt containers and never stored as instructions. Personal contact data is never shared with third-party models.
              </small>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
