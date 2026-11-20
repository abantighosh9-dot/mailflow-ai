import { useState, useRef, useMemo } from "react";
import {
  Monitor, Smartphone, Save, X, Eye, Code2, Sparkles, Check,
  AlertCircle, LayoutTemplate, HelpCircle, Columns, ChevronDown,
  WandSparkles, RefreshCw, Copy, ArrowRight, Lightbulb, FileEdit
} from "lucide-react";
import { api } from "../lib/api";

/**
 * Sanitizes an HTML string using DOMParser to eliminate executable scripts,
 * inline event handlers, and malicious protocols (e.g. javascript:).
 */
export function sanitizeHtml(rawHtml) {
  if (!rawHtml || typeof rawHtml !== "string") return "";

  if (typeof window !== "undefined" && window.DOMParser) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, "text/html");

      // Remove executable and unsafe elements
      const forbiddenTags = [
        "script", "iframe", "object", "embed", "applet",
        "base", "meta", "link", "form"
      ];
      forbiddenTags.forEach(tag => {
        doc.querySelectorAll(tag).forEach(el => el.remove());
      });

      // Strip dangerous attributes (inline event handlers and malicious URI schemes)
      doc.querySelectorAll("*").forEach(el => {
        Array.from(el.attributes).forEach(attr => {
          const name = attr.name.toLowerCase();
          const value = attr.value.trim().toLowerCase();

          if (name.startsWith("on")) {
            el.removeAttribute(attr.name);
          } else if (["href", "src", "action", "xlink:href"].includes(name)) {
            if (
              value.startsWith("javascript:") ||
              value.startsWith("vbscript:") ||
              value.startsWith("data:text/html")
            ) {
              el.removeAttribute(attr.name);
            }
          }
        });
      });

      return doc.body.innerHTML;
    } catch {
      return rawHtml.replace(/<[^>]*>?/gm, "");
    }
  }

  return rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/\s*on\w+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\s*(?:href|src|action)\s*=\s*(['"])\s*(?:javascript|vbscript|data:\s*text\/html):.*?\1/gi, "");
}

/**
 * Replaces personalization tags with realistic mock data for preview purposes.
 */
export function applySamplePlaceholders(text) {
  if (!text) return "";
  return text
    .replace(/\{\{\s*firstName\s*\}\}/gi, "Jane")
    .replace(/\{\{\s*lastName\s*\}\}/gi, "Doe")
    .replace(/\{\{\s*email\s*\}\}/gi, "jane.doe@example.com")
    .replace(/\{\{\s*company\s*\}\}/gi, "Acme Corp");
}

const PLACEHOLDERS = [
  { tag: "{{firstName}}", label: "First Name", sample: "Jane" },
  { tag: "{{lastName}}", label: "Last Name", sample: "Doe" },
  { tag: "{{email}}", label: "Email Address", sample: "jane.doe@example.com" },
  { tag: "{{company}}", label: "Company", sample: "Acme Corp" }
];

export default function EmailEditor({
  campaign,
  templates = [],
  onSave,
  onClose
}) {
  const [subject, setSubject] = useState(campaign?.subject || "");
  const [previewText, setPreviewText] = useState(campaign?.previewText || "");
  const [html, setHtml] = useState(campaign?.html || "");
  const [templateId, setTemplateId] = useState(campaign?.templateId || "");

  // View state: 'split' | 'edit' | 'preview'
  const [viewMode, setViewMode] = useState("split");
  const [mobilePreview, setMobilePreview] = useState(false);
  const [useSampleData, setUseSampleData] = useState(true);

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [previewingTemplate, setPreviewingTemplate] = useState(null);
  const [templateDevice, setTemplateDevice] = useState("desktop");

  // AI Assistant Modal state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiTab, setAiTab] = useState("generate"); // 'generate' | 'improve' | 'subjects'

  // AI Tab 1: Generate state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiPurpose, setAiPurpose] = useState("Product launch");
  const [aiTone, setAiTone] = useState("Professional");
  const [aiAudience, setAiAudience] = useState("Existing customers");
  const [aiCta, setAiCta] = useState("Learn More");
  const [aiBrandName, setAiBrandName] = useState("Your Brand");
  const [aiGeneratedEmail, setAiGeneratedEmail] = useState(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGenerateError, setAiGenerateError] = useState("");

  // AI Tab 2: Improve Content state
  const [aiImproveContent, setAiImproveContent] = useState("");
  const [aiImproveMode, setAiImproveMode] = useState("rewrite");
  const [aiImproveTone, setAiImproveTone] = useState("Professional");
  const [aiImproveInstruction, setAiImproveInstruction] = useState("");
  const [aiImproveResult, setAiImproveResult] = useState(null);
  const [aiImproving, setAiImproving] = useState(false);
  const [aiImproveError, setAiImproveError] = useState("");

  // AI Tab 3: Suggest Subjects state
  const [aiSubjectContext, setAiSubjectContext] = useState("");
  const [aiSubjectTone, setAiSubjectTone] = useState("Professional");
  const [aiSubjectSuggestions, setAiSubjectSuggestions] = useState([]);
  const [aiSubjectTopPick, setAiSubjectTopPick] = useState("");
  const [aiSubjectLoading, setAiSubjectLoading] = useState(false);
  const [aiSubjectError, setAiSubjectError] = useState("");

  // Brand Voice & Audience Personalization state
  const [brandVoice, setBrandVoice] = useState(null);
  const [useBrandVoice, setUseBrandVoice] = useState(true);
  const [aiTargetTags, setAiTargetTags] = useState("");
  const [aiAppliedBrandVoice, setAiAppliedBrandVoice] = useState(false);

  async function loadBrandVoice() {
    try {
      const data = await api("/ai/brand-voice");
      if (data?.brandVoice && data.brandVoice.brandName) {
        setBrandVoice(data.brandVoice);
        if (!aiBrandName || aiBrandName === "Your Brand") {
          setAiBrandName(data.brandVoice.brandName);
        }
        if (data.brandVoice.preferredTone) {
          setAiTone(data.brandVoice.preferredTone);
          setAiImproveTone(data.brandVoice.preferredTone);
          setAiSubjectTone(data.brandVoice.preferredTone);
        }
      }
    } catch {
      // Continue gracefully if brand voice fails to load
    }
  }

  const textareaRef = useRef(null);

  // Insert text/placeholder into the textarea at current cursor position
  function insertAtCursor(snippet) {
    const el = textareaRef.current;
    if (!el) {
      setHtml(prev => prev + snippet);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    const next = text.substring(0, start) + snippet + text.substring(end);
    setHtml(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + snippet.length, start + snippet.length);
    }, 0);
  }

  // Apply template content to campaign draft without modifying original template
  function applyTemplate(t) {
    if (!t) return;
    if (html.trim() && !window.confirm(`Load content from template "${t.name}"? This will replace your current email body in this draft.`)) {
      return;
    }
    setTemplateId(t.id);
    setHtml(t.html || "");
    if (!subject.trim() && t.subject) setSubject(t.subject);
    if (!previewText.trim() && t.previewText) setPreviewText(t.previewText);
    setNotice(`Loaded content from template "${t.name}". Original template remains unchanged.`);
    setPreviewingTemplate(null);
    setTimeout(() => setNotice(""), 4000);
  }

  // Load content from an existing workspace template without modifying original template
  function handleTemplateSelect(selectedId) {
    if (!selectedId) {
      setTemplateId("");
      return;
    }

    const t = templates.find(item => item.id === selectedId);
    if (!t) return;
    applyTemplate(t);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setNotice("");

    try {
      await onSave({
        subject: subject.trim(),
        previewText: previewText.trim() || null,
        html,
        templateId: templateId || null
      });
      setNotice("Campaign email content saved successfully.");
      setTimeout(() => setNotice(""), 3500);
    } catch (e) {
      setError(e.message || "Failed to save email content.");
    } finally {
      setSaving(false);
    }
  }

  // AI Generate Handler
  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true);
    setAiGenerateError("");
    try {
      const tags = aiTargetTags.split(",").map(t => t.trim()).filter(Boolean);
      const data = await api("/ai/generate-email", {
        method: "POST",
        body: JSON.stringify({
          prompt: aiPrompt.trim(),
          purpose: aiPurpose,
          tone: aiTone,
          audience: aiAudience,
          brandName: aiBrandName || "Your Brand",
          cta: aiCta || "Learn More",
          language: "English",
          useBrandVoice,
          targetTags: tags.length > 0 ? tags : undefined
        })
      });
      setAiGeneratedEmail(data.email);
      setAiAppliedBrandVoice(Boolean(data.appliedBrandVoice));
    } catch (e) {
      setAiGenerateError(e.message || "Failed to generate email.");
    } finally {
      setAiGenerating(false);
    }
  }

  // Apply Generated Email to Draft
  function applyGeneratedEmail() {
    if (!aiGeneratedEmail) return;
    if (html.trim() && !window.confirm("Apply AI-generated email to campaign? This will replace your subject line, preview text, and email body.")) {
      return;
    }
    setSubject(aiGeneratedEmail.subject || "");
    setPreviewText(aiGeneratedEmail.previewText || "");
    setHtml(aiGeneratedEmail.html || "");
    setShowAiModal(false);
    setNotice("Applied AI-generated email draft to campaign.");
    setTimeout(() => setNotice(""), 4000);
  }

  // AI Improve Handler
  async function handleAiImprove() {
    if (!aiImproveContent.trim()) return;
    setAiImproving(true);
    setAiImproveError("");
    try {
      const data = await api("/ai/improve-content", {
        method: "POST",
        body: JSON.stringify({
          content: aiImproveContent.trim(),
          mode: aiImproveMode,
          tone: aiImproveTone,
          instruction: aiImproveInstruction.trim() || undefined,
          useBrandVoice
        })
      });
      setAiImproveResult(data);
    } catch (e) {
      setAiImproveError(e.message || "Failed to improve content.");
    } finally {
      setAiImproving(false);
    }
  }

  // Apply Improved Content
  function applyImprovedContent(mode = "replace") {
    if (!aiImproveResult?.improvedContent) return;
    if (mode === "replace") {
      setHtml(aiImproveResult.improvedContent);
      setNotice("Replaced email body with AI improved content.");
    } else {
      insertAtCursor(aiImproveResult.improvedContent);
      setNotice("Inserted AI improved content at cursor.");
    }
    setShowAiModal(false);
    setTimeout(() => setNotice(""), 4000);
  }

  // AI Subjects Handler
  async function handleAiSubjects() {
    if (!aiSubjectContext.trim()) return;
    setAiSubjectLoading(true);
    setAiSubjectError("");
    try {
      const data = await api("/ai/suggest-subjects", {
        method: "POST",
        body: JSON.stringify({
          context: aiSubjectContext.trim(),
          currentSubject: subject.trim() || undefined,
          tone: aiSubjectTone,
          count: 5,
          useBrandVoice
        })
      });
      setAiSubjectSuggestions(data.suggestions || []);
      setAiSubjectTopPick(data.improvedSubject || "");
    } catch (e) {
      setAiSubjectError(e.message || "Failed to generate subject lines.");
    } finally {
      setAiSubjectLoading(false);
    }
  }

  // Use Selected Subject Line
  function handleUseSubject(sugg) {
    if (!sugg) return;
    setSubject(sugg.subject || "");
    if (sugg.previewText) {
      setPreviewText(sugg.previewText);
    }
    setShowAiModal(false);
    setNotice(`Updated subject line to: "${sugg.subject}"`);
    setTimeout(() => setNotice(""), 4000);
  }

  // Prepare safe preview output
  const previewSubject = useSampleData ? applySamplePlaceholders(subject) : subject;
  const previewSnippet = useSampleData ? applySamplePlaceholders(previewText) : previewText;
  const renderedHtml = useMemo(() => {
    const interpolated = useSampleData ? applySamplePlaceholders(html) : html;
    return sanitizeHtml(interpolated);
  }, [html, useSampleData]);

  return (
    <div className="modal-backdrop" style={{ zIndex: 100, padding: "12px" }}>
      <div
        className="modal"
        style={{
          width: "min(100%, 1280px)",
          height: "92vh",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          padding: "0",
          overflow: "hidden"
        }}
      >
        {/* TOP BAR */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #eceef4",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#fff",
            gap: "12px",
            flexWrap: "wrap"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div>
              <span className="eyebrow">CAMPAIGN EMAIL EDITOR</span>
              <h2 style={{ fontSize: "16px", margin: "2px 0 0" }}>{campaign?.name || "Draft Campaign"}</h2>
            </div>

            {/* Template Selector */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "14px" }}>
              <LayoutTemplate size={14} className="muted" />
              <select
                value={templateId}
                onChange={e => handleTemplateSelect(e.target.value)}
                style={{
                  border: "1px solid #eceef4",
                  borderRadius: "7px",
                  padding: "6px 10px",
                  fontSize: "11px",
                  background: "#fafbfe"
                }}
              >
                <option value="">Load from template…</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              {templateId && (
                <button
                  type="button"
                  className="soft-button"
                  onClick={() => {
                    const t = templates.find(item => item.id === templateId);
                    if (t) setPreviewingTemplate(t);
                  }}
                  title="Preview template before applying"
                  style={{ padding: "5px 8px", fontSize: "11px" }}
                >
                  <Eye size={13} />
                </button>
              )}
            </div>
          </div>

          {/* VIEW TOGGLES & ACTIONS */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* AI Assistant Button */}
            <button
              type="button"
              className="soft-button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "#f4f0ff",
                color: "#6545bc",
                borderColor: "#d8cdf8",
                padding: "6px 12px",
                fontSize: "11px",
                fontWeight: "700"
              }}
              onClick={() => {
                setShowAiModal(true);
                loadBrandVoice();
                if (!aiImproveContent) {
                  setAiImproveContent(html || "");
                }
                if (!aiSubjectContext) {
                  const summary = [subject, previewText, (html || "").replace(/<[^>]*>?/gm, " ").slice(0, 300)].filter(Boolean).join(" - ");
                  setAiSubjectContext(summary || campaign?.name || "Marketing campaign");
                }
              }}
              title="Open AI Email Studio Assistant"
            >
              <Sparkles size={13} /> AI Assistant
            </button>

            {/* View Mode (Split, Edit Only, Preview Only) */}
            <div
              style={{
                display: "inline-flex",
                background: "#f0f1f5",
                borderRadius: "8px",
                padding: "3px"
              }}
            >
              <button
                type="button"
                className={`soft-button ${viewMode === "split" ? "active" : ""}`}
                style={{
                  padding: "5px 10px",
                  fontSize: "11px",
                  border: "0",
                  background: viewMode === "split" ? "#fff" : "transparent"
                }}
                onClick={() => setViewMode("split")}
                title="Side-by-side view"
              >
                <Columns size={13} /> Split
              </button>
              <button
                type="button"
                className={`soft-button ${viewMode === "edit" ? "active" : ""}`}
                style={{
                  padding: "5px 10px",
                  fontSize: "11px",
                  border: "0",
                  background: viewMode === "edit" ? "#fff" : "transparent"
                }}
                onClick={() => setViewMode("edit")}
                title="Code only"
              >
                <Code2 size={13} /> Code
              </button>
              <button
                type="button"
                className={`soft-button ${viewMode === "preview" ? "active" : ""}`}
                style={{
                  padding: "5px 10px",
                  fontSize: "11px",
                  border: "0",
                  background: viewMode === "preview" ? "#fff" : "transparent"
                }}
                onClick={() => setViewMode("preview")}
                title="Preview only"
              >
                <Eye size={13} /> Preview
              </button>
            </div>

            {/* Save Button */}
            <button
              type="button"
              className="primary-button"
              onClick={handleSave}
              disabled={saving}
              style={{ padding: "8px 14px" }}
            >
              {saving ? "Saving…" : <><Save size={14} /> Save Content</>}
            </button>

            {/* Close Button */}
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              title="Close editor"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* NOTICES & ALERTS */}
        {notice && (
          <div style={{ background: "#e9f8f1", color: "#269769", padding: "8px 20px", fontSize: "11px", fontWeight: "600" }}>
            ✓ {notice}
          </div>
        )}
        {error && (
          <div style={{ background: "#fff0f0", color: "#c34a4a", padding: "8px 20px", fontSize: "11px" }}>
            ✕ {error}
          </div>
        )}

        {/* WORKSPACE AREA */}
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns:
              viewMode === "split"
                ? "1fr 1fr"
                : viewMode === "edit"
                ? "1fr"
                : "1fr",
            overflow: "hidden",
            background: "#fafbfe"
          }}
        >
          {/* LEFT: EDITING PANE */}
          {(viewMode === "split" || viewMode === "edit") && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                borderRight: viewMode === "split" ? "1px solid #eceef4" : "0",
                background: "#fff",
                height: "100%",
                overflowY: "auto",
                padding: "16px 20px"
              }}
            >
              {/* SUBJECT & PREHEADER */}
              <div style={{ marginBottom: "12px" }}>
                <label className="field-label" style={{ marginBottom: "8px" }}>
                  Subject Line *
                  <input
                    placeholder="Enter email subject line"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                  />
                </label>
                <label className="field-label" style={{ marginBottom: "8px" }}>
                  Preview Text (Pre-header snippet)
                  <input
                    placeholder="Brief inbox snippet shown next to subject line"
                    value={previewText}
                    onChange={e => setPreviewText(e.target.value)}
                  />
                </label>
              </div>

              {/* PERSONALIZATION PLACEHOLDERS BAR */}
              <div
                style={{
                  background: "#f7f5ff",
                  borderRadius: "8px",
                  padding: "10px 12px",
                  marginBottom: "12px",
                  border: "1px solid #ece7ff"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ fontSize: "10px", fontWeight: "800", color: "#6545bc", letterSpacing: ".05em" }}>
                    INSERT PERSONALIZATION TAG
                  </span>
                  <span className="muted" style={{ fontSize: "10px" }}>Click to insert at cursor</span>
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {PLACEHOLDERS.map(p => (
                    <button
                      type="button"
                      key={p.tag}
                      className="chip"
                      style={{ padding: "4px 8px", fontSize: "11px", background: "#fff", borderColor: "#d5cbf5" }}
                      onClick={() => insertAtCursor(p.tag)}
                      title={`Insert ${p.label} (sample: "${p.sample}")`}
                    >
                      <b>{p.tag}</b> <small style={{ color: "#8b91a3" }}>({p.label})</small>
                    </button>
                  ))}
                </div>
              </div>

              {/* QUICK HTML SNIPPETS TOOLBAR */}
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px", alignItems: "center" }}>
                <span className="muted" style={{ fontSize: "10px", fontWeight: "700" }}>SNIPPETS:</span>
                <button
                  type="button"
                  className="soft-button"
                  style={{ padding: "3px 7px", fontSize: "10px" }}
                  onClick={() => insertAtCursor('<h1 style="font-size:24px;color:#1e2530;margin:16px 0;">Heading</h1>\n')}
                >
                  Heading
                </button>
                <button
                  type="button"
                  className="soft-button"
                  style={{ padding: "3px 7px", fontSize: "10px" }}
                  onClick={() => insertAtCursor('<p style="font-size:14px;line-height:1.6;color:#4a5060;margin:12px 0;">Your message text here...</p>\n')}
                >
                  Paragraph
                </button>
                <button
                  type="button"
                  className="soft-button"
                  style={{ padding: "3px 7px", fontSize: "10px" }}
                  onClick={() => insertAtCursor('<div style="text-align:center;margin:24px 0;"><a href="https://example.com" style="display:inline-block;background:#6545bc;color:#ffffff;padding:12px 28px;border-radius:6px;font-weight:700;text-decoration:none;">Click Here</a></div>\n')}
                >
                  CTA Button
                </button>
                <button
                  type="button"
                  className="soft-button"
                  style={{ padding: "3px 7px", fontSize: "10px" }}
                  onClick={() => insertAtCursor('<hr style="border:0;border-top:1px solid #e9eaf1;margin:24px 0;" />\n')}
                >
                  Divider
                </button>
                <button
                  type="button"
                  className="soft-button"
                  style={{ padding: "3px 7px", fontSize: "10px" }}
                  onClick={() => insertAtCursor('<div style="background:#fafbfe;border:1px solid #eceef4;border-radius:8px;padding:16px;margin:16px 0;"><h3 style="margin-top:0;font-size:16px;">Special Announcement</h3><p style="margin-bottom:0;color:#60677a;">Details here...</p></div>\n')}
                >
                  Callout Box
                </button>
              </div>

              {/* HTML BODY EDITOR */}
              <label className="field-label" style={{ flex: 1, display: "flex", flexDirection: "column", marginBottom: 0 }}>
                HTML Email Body
                <textarea
                  ref={textareaRef}
                  value={html}
                  onChange={e => setHtml(e.target.value)}
                  placeholder="<!DOCTYPE html><html><body><h1>Hello {{firstName}}</h1><p>Type or paste your HTML email template here...</p></body></html>"
                  style={{
                    flex: 1,
                    minHeight: "260px",
                    fontFamily: "Consolas, Monaco, 'Courier New', monospace",
                    fontSize: "12px",
                    lineHeight: "1.55",
                    whiteSpace: "pre",
                    tabSize: 2,
                    background: "#fafbfe"
                  }}
                />
              </label>
            </div>
          )}

          {/* RIGHT: LIVE PREVIEW PANE */}
          {(viewMode === "split" || viewMode === "preview") && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                overflowY: "auto",
                padding: "16px 20px"
              }}
            >
              {/* PREVIEW TOOLBAR */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "12px",
                  background: "#fff",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid #eceef4"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "#4e5568" }}>Preview Mode:</span>
                  <button
                    type="button"
                    className={`icon-button ${!mobilePreview ? "selected" : ""}`}
                    onClick={() => setMobilePreview(false)}
                    title="Desktop Preview (600px)"
                  >
                    <Monitor size={16} />
                  </button>
                  <button
                    type="button"
                    className={`icon-button ${mobilePreview ? "selected" : ""}`}
                    onClick={() => setMobilePreview(true)}
                    title="Mobile Preview (360px)"
                  >
                    <Smartphone size={16} />
                  </button>
                </div>

                {/* Sample Data Toggle */}
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", cursor: "pointer", color: "#60677a" }}>
                  <input
                    type="checkbox"
                    checked={useSampleData}
                    onChange={e => setUseSampleData(e.target.checked)}
                  />
                  <span>Preview with sample contact</span>
                </label>
              </div>

              {/* INBOX ENVELOPE SIMULATION */}
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #eceef4",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  marginBottom: "16px"
                }}
              >
                <div style={{ fontSize: "13px", fontWeight: "800", color: "#1e2530", marginBottom: "4px" }}>
                  {previewSubject || <span className="muted">No subject specified</span>}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#60677a" }}>
                  <span>
                    <b>{campaign?.fromName || "MailFlow Team"}</b> &lt;{campaign?.fromEmail || "sender@example.com"}&gt;
                  </span>
                  <span className="muted">to: {useSampleData ? "Jane Doe <jane.doe@example.com>" : "{{email}}"}</span>
                </div>
                {previewSnippet && (
                  <div className="muted" style={{ fontSize: "11px", marginTop: "4px" }}>
                    Snippet: {previewSnippet}
                  </div>
                )}
              </div>

              {/* EMAIL BODY CANVAS */}
              <div className="email-canvas-wrap" style={{ flex: 1, margin: 0, padding: "16px", background: "#f3f4f8" }}>
                {!html.trim() ? (
                  <div className="empty-preview" style={{ minHeight: "300px" }}>
                    <Eye size={32} className="muted" style={{ marginBottom: "12px" }} />
                    <h4>Your email preview will appear here</h4>
                    <p>Enter HTML in the editor or select an existing template to preview your design.</p>
                  </div>
                ) : (
                  <div
                    className={`email-canvas ${mobilePreview ? "mobile-preview" : ""}`}
                    style={{
                      minHeight: "360px",
                      background: "#fff",
                      boxShadow: "0 3px 20px #1e25300d",
                      borderRadius: "6px",
                      padding: "20px",
                      overflowX: "auto"
                    }}
                    dangerouslySetInnerHTML={{ __html: renderedHtml }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI ASSISTANT MODAL */}
      {showAiModal && (
        <div className="modal-backdrop" style={{ zIndex: 120, padding: "16px" }}>
          <div
            className="modal"
            style={{
              width: "min(100%, 1020px)",
              height: "88vh",
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              padding: "0",
              overflow: "hidden",
              borderRadius: "14px",
              background: "#fff"
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "16px 22px",
                borderBottom: "1px solid #eceef4",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#fafbfe"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "10px",
                    background: "#f0edfc",
                    color: "#6545bc",
                    display: "grid",
                    placeItems: "center"
                  }}
                >
                  <Sparkles size={18} />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <h2 style={{ fontSize: "16px", margin: 0, fontWeight: "800" }}>AI Email Studio Assistant</h2>
                    <span className="ai-label"><Sparkles size={11} /> AI POWERED</span>
                  </div>
                  <p className="muted" style={{ fontSize: "11px", margin: "2px 0 0" }}>
                    Generate structured email drafts, refine copy, or explore high-converting subject lines.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowAiModal(false)}
                title="Close AI Assistant"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tabs */}
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid #eceef4",
                padding: "0 22px",
                background: "#fff",
                gap: "16px",
                alignItems: "center"
              }}
            >
              <button
                type="button"
                onClick={() => setAiTab("generate")}
                style={{
                  padding: "12px 4px",
                  fontSize: "12px",
                  fontWeight: "700",
                  border: "0",
                  background: "none",
                  borderBottom: aiTab === "generate" ? "2px solid #6545bc" : "2px solid transparent",
                  color: aiTab === "generate" ? "#6545bc" : "#73798a",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}
              >
                <WandSparkles size={14} /> Generate Email
              </button>
              <button
                type="button"
                onClick={() => {
                  setAiTab("improve");
                  if (!aiImproveContent && html) setAiImproveContent(html);
                }}
                style={{
                  padding: "12px 4px",
                  fontSize: "12px",
                  fontWeight: "700",
                  border: "0",
                  background: "none",
                  borderBottom: aiTab === "improve" ? "2px solid #6545bc" : "2px solid transparent",
                  color: aiTab === "improve" ? "#6545bc" : "#73798a",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}
              >
                <FileEdit size={14} /> Improve Content
              </button>
              <button
                type="button"
                onClick={() => {
                  setAiTab("subjects");
                  if (!aiSubjectContext) {
                    const summary = [subject, previewText, (html || "").replace(/<[^>]*>?/gm, " ").slice(0, 300)].filter(Boolean).join(" - ");
                    setAiSubjectContext(summary || campaign?.name || "Campaign details");
                  }
                }}
                style={{
                  padding: "12px 4px",
                  fontSize: "12px",
                  fontWeight: "700",
                  border: "0",
                  background: "none",
                  borderBottom: aiTab === "subjects" ? "2px solid #6545bc" : "2px solid transparent",
                  color: aiTab === "subjects" ? "#6545bc" : "#73798a",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}
              >
                <Lightbulb size={14} /> Subject Suggestions
              </button>

              {brandVoice?.brandName && (
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: "600", cursor: "pointer", color: useBrandVoice ? "#6545bc" : "#8a90a0" }}>
                    <input
                      type="checkbox"
                      checked={useBrandVoice}
                      onChange={e => setUseBrandVoice(e.target.checked)}
                      style={{ width: "auto", margin: 0 }}
                    />
                    <span>Brand Voice: <b>{brandVoice.brandName}</b></span>
                  </label>
                  {useBrandVoice && (
                    <span className="chip" style={{ padding: "2px 6px", fontSize: "9px", background: "#f0edfc", color: "#6545bc", borderColor: "#cbbff0" }}>
                      Active
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Tab Contents */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px", background: "#fafbfe" }}>
              {/* TAB 1: GENERATE EMAIL */}
              {aiTab === "generate" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", height: "100%", alignItems: "start" }}>
                  <div style={{ background: "#fff", padding: "18px", borderRadius: "10px", border: "1px solid #eceef4" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                      <WandSparkles size={16} color="#6545bc" />
                      <h3 style={{ fontSize: "14px", margin: 0, fontWeight: "700" }}>Campaign Brief</h3>
                    </div>

                    <label className="field-label" style={{ marginBottom: "12px" }}>
                      Campaign Description & Instructions *
                      <textarea
                        rows="5"
                        placeholder="Describe what you want to communicate, your offer, key benefits, and goals..."
                        value={aiPrompt}
                        onChange={e => setAiPrompt(e.target.value)}
                        style={{ fontSize: "12px" }}
                      />
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                      <label className="field-label" style={{ margin: 0 }}>
                        Email Purpose
                        <select value={aiPurpose} onChange={e => setAiPurpose(e.target.value)} style={{ fontSize: "12px" }}>
                          {["Product launch", "Promotion", "Newsletter", "Welcome email", "Event invitation", "Announcement", "Re-engagement"].map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label" style={{ margin: 0 }}>
                        Writing Tone
                        <select value={aiTone} onChange={e => setAiTone(e.target.value)} style={{ fontSize: "12px" }}>
                          {["Professional", "Friendly", "Persuasive", "Conversational", "Formal", "Promotional", "Minimal"].map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                      <label className="field-label" style={{ margin: 0 }}>
                        Target Audience
                        <select value={aiAudience} onChange={e => setAiAudience(e.target.value)} style={{ fontSize: "12px" }}>
                          {["Existing customers", "New subscribers", "Potential customers", "VIP customers", "General audience"].map(a => (
                            <option key={a} value={a}>{a}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label" style={{ margin: 0 }}>
                        Call to Action Label
                        <input
                          placeholder="e.g. Shop Collection"
                          value={aiCta}
                          onChange={e => setAiCta(e.target.value)}
                          style={{ fontSize: "12px" }}
                        />
                      </label>
                    </div>

                    <div className="form-two" style={{ marginBottom: "12px" }}>
                      <label className="field-label" style={{ margin: 0 }}>
                        Brand / Sender Name
                        <input
                          placeholder="e.g. MailFlow AI"
                          value={aiBrandName}
                          onChange={e => setAiBrandName(e.target.value)}
                          style={{ fontSize: "12px" }}
                        />
                      </label>
                      <label className="field-label" style={{ margin: 0 }}>
                        Target Segment Tags (Optional)
                        <input
                          placeholder="e.g. VIP, Enterprise"
                          value={aiTargetTags}
                          onChange={e => setAiTargetTags(e.target.value)}
                          style={{ fontSize: "12px" }}
                        />
                      </label>
                    </div>

                    <div style={{ marginBottom: "14px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: "700", color: "#4e5568", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={useBrandVoice}
                          onChange={e => setUseBrandVoice(e.target.checked)}
                          style={{ width: "auto", margin: 0 }}
                        />
                        <span>Apply Workspace Brand Voice {brandVoice?.brandName ? `(${brandVoice.brandName})` : ""}</span>
                      </label>
                      <small style={{ color: "#8a90a0", fontSize: "10px", marginTop: "2px", display: "block" }}>
                        Incorporates brand personality, preferred vocabulary, and strictly scrubs prohibited phrases.
                      </small>
                    </div>

                    <button
                      type="button"
                      className="primary-button"
                      style={{ width: "100%", padding: "11px", justifyContent: "center" }}
                      onClick={handleAiGenerate}
                      disabled={aiGenerating || !aiPrompt.trim()}
                    >
                      {aiGenerating ? (
                        <><RefreshCw className="spin" size={15} /> Generating Complete Draft…</>
                      ) : (
                        <><Sparkles size={15} /> Generate Complete Email Draft <ArrowRight size={15} /></>
                      )}
                    </button>

                    {aiGenerateError && (
                      <div className="error-box" style={{ marginTop: "12px" }}>
                        {aiGenerateError}
                      </div>
                    )}
                  </div>

                  {/* Right Preview */}
                  <div style={{ background: "#fff", padding: "18px", borderRadius: "10px", border: "1px solid #eceef4", minHeight: "420px", display: "flex", flexDirection: "column" }}>
                    {!aiGeneratedEmail ? (
                      <div className="empty-preview" style={{ minHeight: "360px", flex: 1 }}>
                        <div className="empty-icon"><WandSparkles size={26} /></div>
                        <h3>AI Email Generator</h3>
                        <p>Fill out the campaign details and click Generate. MailFlow AI will structure persuasive copy, headers, content blocks, and responsive HTML ready for review.</p>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", height: "100%", flex: 1 }}>
                        <div style={{ background: "#f8f9fc", padding: "12px 14px", borderRadius: "8px", marginBottom: "12px", border: "1px solid #eceef4" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                            <div style={{ fontSize: "11px", color: "#60677a" }}>
                              <b>Subject:</b> {aiGeneratedEmail.subject}
                            </div>
                            {aiAppliedBrandVoice && (
                              <span className="chip" style={{ padding: "2px 6px", fontSize: "9px", background: "#f0edfc", color: "#6545bc", borderColor: "#cbbff0" }}>
                                ★ Brand Voice Applied
                              </span>
                            )}
                          </div>
                          {aiGeneratedEmail.previewText && (
                            <div style={{ fontSize: "11px", color: "#8a90a0" }}>
                              <b>Preheader:</b> {aiGeneratedEmail.previewText}
                            </div>
                          )}
                        </div>

                        <div style={{ flex: 1, minHeight: "260px", border: "1px solid #eceef4", borderRadius: "8px", overflow: "hidden", background: "#f5f6f9" }}>
                          <iframe
                            srcDoc={sanitizeHtml(aiGeneratedEmail.html)}
                            title="Generated Email Preview"
                            style={{ width: "100%", height: "260px", border: 0, background: "#fff" }}
                          />
                        </div>

                        <div style={{ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className="soft-button"
                            onClick={() => {
                              navigator.clipboard.writeText(aiGeneratedEmail.html);
                              setNotice("Copied HTML to clipboard.");
                              setTimeout(() => setNotice(""), 3000);
                            }}
                          >
                            <Copy size={13} /> Copy HTML
                          </button>
                          <button
                            type="button"
                            className="soft-button"
                            onClick={() => setAiGeneratedEmail(null)}
                          >
                            <RefreshCw size={13} /> Clear
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={applyGeneratedEmail}
                            style={{ padding: "8px 16px" }}
                          >
                            <Check size={14} /> Apply to Campaign Draft
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: IMPROVE CONTENT */}
              {aiTab === "improve" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", height: "100%", alignItems: "start" }}>
                  <div style={{ background: "#fff", padding: "18px", borderRadius: "10px", border: "1px solid #eceef4" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                      <FileEdit size={16} color="#6545bc" />
                      <h3 style={{ fontSize: "14px", margin: 0, fontWeight: "700" }}>Content to Improve</h3>
                    </div>

                    <label className="field-label" style={{ marginBottom: "12px" }}>
                      Input Text or HTML Snippet *
                      <textarea
                        rows="8"
                        placeholder="Paste or edit the text/HTML you want to improve..."
                        value={aiImproveContent}
                        onChange={e => setAiImproveContent(e.target.value)}
                        style={{ fontSize: "12px", fontFamily: "Consolas, Monaco, monospace" }}
                      />
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                      <label className="field-label" style={{ margin: 0 }}>
                        Improvement Goal
                        <select value={aiImproveMode} onChange={e => setAiImproveMode(e.target.value)} style={{ fontSize: "12px" }}>
                          <option value="rewrite">Rewrite & Polish</option>
                          <option value="shorten">Condense & Shorten</option>
                          <option value="expand">Add Detail & Depth</option>
                          <option value="clarify">Improve Clarity</option>
                          <option value="change_tone">Adjust Tone</option>
                          <option value="fix_grammar">Fix Grammar & Typos</option>
                          <option value="improve_cta">Optimize Call to Action</option>
                        </select>
                      </label>
                      <label className="field-label" style={{ margin: 0 }}>
                        Desired Tone
                        <select value={aiImproveTone} onChange={e => setAiImproveTone(e.target.value)} style={{ fontSize: "12px" }}>
                          {["Professional", "Friendly", "Persuasive", "Conversational", "Formal", "Promotional", "Minimal"].map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="field-label" style={{ marginBottom: "14px" }}>
                      Specific Instructions (Optional)
                      <input
                        placeholder="e.g. emphasize free shipping, keep under 3 sentences"
                        value={aiImproveInstruction}
                        onChange={e => setAiImproveInstruction(e.target.value)}
                        style={{ fontSize: "12px" }}
                      />
                    </label>

                    <div style={{ marginBottom: "14px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: "700", color: "#4e5568", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={useBrandVoice}
                          onChange={e => setUseBrandVoice(e.target.checked)}
                          style={{ width: "auto", margin: 0 }}
                        />
                        <span>Follow Workspace Brand Voice Guidelines</span>
                      </label>
                    </div>

                    <button
                      type="button"
                      className="primary-button"
                      style={{ width: "100%", padding: "11px", justifyContent: "center" }}
                      onClick={handleAiImprove}
                      disabled={aiImproving || !aiImproveContent.trim()}
                    >
                      {aiImproving ? (
                        <><RefreshCw className="spin" size={15} /> Refining Content…</>
                      ) : (
                        <><Sparkles size={15} /> Improve Content</>
                      )}
                    </button>

                    {aiImproveError && (
                      <div className="error-box" style={{ marginTop: "12px" }}>
                        {aiImproveError}
                      </div>
                    )}
                  </div>

                  {/* Right: Improved Result */}
                  <div style={{ background: "#fff", padding: "18px", borderRadius: "10px", border: "1px solid #eceef4", minHeight: "420px", display: "flex", flexDirection: "column" }}>
                    {!aiImproveResult ? (
                      <div className="empty-preview" style={{ minHeight: "360px", flex: 1 }}>
                        <div className="empty-icon"><FileEdit size={26} /></div>
                        <h3>AI Copy Improver</h3>
                        <p>Select your goal (shorten, expand, clarify, change tone, or fix grammar) and let AI suggest polished revisions without changing your underlying facts.</p>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", height: "100%", flex: 1 }}>
                        <div style={{ background: "#eef8f2", color: "#228b57", padding: "10px 14px", borderRadius: "8px", fontSize: "11px", fontWeight: "600", marginBottom: "12px" }}>
                          ✓ {aiImproveResult.changesSummary}
                        </div>

                        <label className="field-label" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                          Improved Content
                          <textarea
                            rows="10"
                            value={aiImproveResult.improvedContent}
                            onChange={e => setAiImproveResult(prev => ({ ...prev, improvedContent: e.target.value }))}
                            style={{ flex: 1, fontSize: "12px", fontFamily: "Consolas, Monaco, monospace" }}
                          />
                        </label>

                        <div style={{ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className="soft-button"
                            onClick={() => {
                              navigator.clipboard.writeText(aiImproveResult.improvedContent);
                              setNotice("Copied improved content to clipboard.");
                              setTimeout(() => setNotice(""), 3000);
                            }}
                          >
                            <Copy size={13} /> Copy
                          </button>
                          <button
                            type="button"
                            className="soft-button"
                            onClick={() => applyImprovedContent("insert")}
                          >
                            <ArrowRight size={13} /> Insert at Cursor
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => applyImprovedContent("replace")}
                            style={{ padding: "8px 16px" }}
                          >
                            <Check size={14} /> Replace Email Body
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: SUBJECT SUGGESTIONS */}
              {aiTab === "subjects" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: "20px", height: "100%", alignItems: "start" }}>
                  <div style={{ background: "#fff", padding: "18px", borderRadius: "10px", border: "1px solid #eceef4" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                      <Lightbulb size={16} color="#6545bc" />
                      <h3 style={{ fontSize: "14px", margin: 0, fontWeight: "700" }}>Subject Line Context</h3>
                    </div>

                    <label className="field-label" style={{ marginBottom: "12px" }}>
                      Campaign Context / Key Message *
                      <textarea
                        rows="5"
                        placeholder="What is this email about? Mention main offer, announcement, or theme..."
                        value={aiSubjectContext}
                        onChange={e => setAiSubjectContext(e.target.value)}
                        style={{ fontSize: "12px" }}
                      />
                    </label>

                    <label className="field-label" style={{ marginBottom: "12px" }}>
                      Current Subject Line (Optional)
                      <input
                        placeholder="Current subject line you want to improve..."
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        style={{ fontSize: "12px" }}
                      />
                    </label>

                    <label className="field-label" style={{ marginBottom: "14px" }}>
                      Writing Tone
                      <select value={aiSubjectTone} onChange={e => setAiSubjectTone(e.target.value)} style={{ fontSize: "12px" }}>
                        {["Professional", "Friendly", "Persuasive", "Conversational", "Formal", "Promotional", "Minimal"].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </label>

                    <div style={{ marginBottom: "14px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: "700", color: "#4e5568", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={useBrandVoice}
                          onChange={e => setUseBrandVoice(e.target.checked)}
                          style={{ width: "auto", margin: 0 }}
                        />
                        <span>Match Workspace Brand Voice</span>
                      </label>
                    </div>

                    <button
                      type="button"
                      className="primary-button"
                      style={{ width: "100%", padding: "11px", justifyContent: "center" }}
                      onClick={handleAiSubjects}
                      disabled={aiSubjectLoading || !aiSubjectContext.trim()}
                    >
                      {aiSubjectLoading ? (
                        <><RefreshCw className="spin" size={15} /> Generating Subject Ideas…</>
                      ) : (
                        <><Lightbulb size={15} /> Suggest 5 Subject Lines</>
                      )}
                    </button>

                    {aiSubjectError && (
                      <div className="error-box" style={{ marginTop: "12px" }}>
                        {aiSubjectError}
                      </div>
                    )}
                  </div>

                  {/* Right: Subject Suggestions List */}
                  <div style={{ background: "#fff", padding: "18px", borderRadius: "10px", border: "1px solid #eceef4", minHeight: "420px" }}>
                    {aiSubjectSuggestions.length === 0 ? (
                      <div className="empty-preview" style={{ minHeight: "360px" }}>
                        <div className="empty-icon"><Lightbulb size={26} /></div>
                        <h3>High-Converting Subject Lines</h3>
                        <p>Provide your campaign context on the left and click Suggest to explore 5 tailored subject line variations with preview preheader snippets.</p>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {aiSubjectTopPick && (
                          <div style={{ background: "#f5f0ff", border: "1px solid #e1d5fd", padding: "10px 14px", borderRadius: "8px", marginBottom: "4px" }}>
                            <span style={{ fontSize: "10px", fontWeight: "800", color: "#6545bc", letterSpacing: "1px" }}>★ TOP RECOMMENDATION</span>
                            <div style={{ fontSize: "13px", fontWeight: "700", color: "#282a36", marginTop: "2px" }}>{aiSubjectTopPick}</div>
                          </div>
                        )}

                        {aiSubjectSuggestions.map((sugg, idx) => (
                          <div
                            key={idx}
                            style={{
                              border: "1px solid #eceef4",
                              borderRadius: "8px",
                              padding: "12px 14px",
                              background: "#fafbfe",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: "12px"
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                                <span style={{ fontSize: "13px", fontWeight: "700", color: "#1e2530" }}>{sugg.subject}</span>
                                {sugg.style && (
                                  <span className="chip" style={{ padding: "2px 6px", fontSize: "9px", background: "#f0edfc", color: "#6545bc", borderColor: "#e1d7fc" }}>
                                    {sugg.style}
                                  </span>
                                )}
                              </div>
                              {sugg.previewText && (
                                <p style={{ margin: 0, fontSize: "11px", color: "#747a8c", lineHeight: "1.4" }}>
                                  <b>Preheader:</b> {sugg.previewText}
                                </p>
                              )}
                            </div>

                            <button
                              type="button"
                              className="primary-button"
                              style={{ padding: "6px 12px", fontSize: "11px", flexShrink: 0 }}
                              onClick={() => handleUseSubject(sugg)}
                            >
                              <Check size={12} /> Use This
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Template Preview Modal */}
      {previewingTemplate && (
        <div className="modal-backdrop" style={{ zIndex: 110 }}>
          <div className="modal" style={{ width: "min(100%, 880px)", height: "85vh", display: "flex", flexDirection: "column", padding: "0" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #eceef4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <b style={{ fontSize: "14px" }}>Preview Template: {previewingTemplate.name}</b>
                <span className="muted" style={{ display: "block", fontSize: "11px" }}>
                  Subject: {previewingTemplate.subject || "No subject"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ display: "inline-flex", background: "#f0f1f5", borderRadius: "8px", padding: "3px" }}>
                  <button
                    type="button"
                    className={`soft-button ${templateDevice === "desktop" ? "active" : ""}`}
                    style={{ padding: "4px 8px", fontSize: "11px", border: 0 }}
                    onClick={() => setTemplateDevice("desktop")}
                  >
                    <Monitor size={12} /> Desktop
                  </button>
                  <button
                    type="button"
                    className={`soft-button ${templateDevice === "mobile" ? "active" : ""}`}
                    style={{ padding: "4px 8px", fontSize: "11px", border: 0 }}
                    onClick={() => setTemplateDevice("mobile")}
                  >
                    <Smartphone size={12} /> Mobile
                  </button>
                </div>
                <button className="icon-button" type="button" onClick={() => setPreviewingTemplate(null)}>
                  <X size={16} />
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", background: "#f4f5f8", padding: "20px", display: "flex", justifyContent: "center" }}>
              <div
                style={{
                  width: templateDevice === "mobile" ? "360px" : "600px",
                  background: "#fff",
                  borderRadius: "8px",
                  boxShadow: "0 2px 16px rgba(0,0,0,0.06)",
                  overflow: "hidden",
                  padding: "16px"
                }}
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(applySamplePlaceholders(previewingTemplate.html))
                }}
              />
            </div>

            <div style={{ padding: "12px 20px", borderTop: "1px solid #eceef4", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button type="button" className="soft-button" onClick={() => setPreviewingTemplate(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                style={{ padding: "8px 16px", fontSize: "12px" }}
                onClick={() => applyTemplate(previewingTemplate)}
              >
                Apply to Campaign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
