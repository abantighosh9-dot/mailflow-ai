import { useState, useEffect } from "react";
import {
  Sparkles, WandSparkles, Copy, Save, Monitor, Smartphone,
  RefreshCw, ArrowRight, Check, FileEdit, Lightbulb, Users, Shield
} from "lucide-react";
import { api } from "../lib/api";

const TONES = ["Professional", "Friendly", "Persuasive", "Conversational", "Formal", "Promotional", "Minimal"];
const PURPOSES = ["Product launch", "Promotion", "Newsletter", "Welcome email", "Event invitation", "Announcement", "Re-engagement"];
const AUDIENCES = ["Existing customers", "New subscribers", "Potential customers", "VIP customers", "General audience"];

export default function EmailStudio() {
  const [activeTab, setActiveTab] = useState("generator"); // 'generator' | 'personalize' | 'subjects' | 'improver'

  // Workspace Brand Voice State
  const [brandVoice, setBrandVoice] = useState(null);
  const [useBrandVoice, setUseBrandVoice] = useState(true);

  // Tab 1: Full Email Generator
  const [prompt, setPrompt] = useState("Create a premium product launch email for a new summer skincare collection. Introduce the collection, highlight a 20% launch offer, use an elegant and friendly tone, and include a strong shop-now call to action.");
  const [purpose, setPurpose] = useState("Product launch");
  const [tone, setTone] = useState("Professional");
  const [audience, setAudience] = useState("Existing customers");
  const [brandName, setBrandName] = useState("Your Brand");
  const [cta, setCta] = useState("Shop Collection");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mobile, setMobile] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState("");
  const [appliedBrandVoice, setAppliedBrandVoice] = useState(false);

  // Tab 2: Audience Personalization
  const [personalizePrompt, setPersonalizePrompt] = useState("Quarterly product VIP roadmap update and early access invitation for top accounts.");
  const [targetTags, setTargetTags] = useState("VIP, Enterprise");
  const [sampleFirstName, setSampleFirstName] = useState("Alex");
  const [sampleCompany, setSampleCompany] = useState("TechNova");
  const [personalizeResult, setPersonalizeResult] = useState(null);
  const [personalizeLoading, setPersonalizeLoading] = useState(false);
  const [personalizeError, setPersonalizeError] = useState("");

  // Tab 3: Subject Line Studio
  const [subjectContext, setSubjectContext] = useState("New summer skincare launch featuring organic sun protection and a 20% introductory discount.");
  const [currentSubject, setCurrentSubject] = useState("");
  const [subjectTone, setSubjectTone] = useState("Persuasive");
  const [subjectSuggestions, setSubjectSuggestions] = useState([]);
  const [subjectTopPick, setSubjectTopPick] = useState("");
  const [subjectLoading, setSubjectLoading] = useState(false);
  const [subjectError, setSubjectError] = useState("");
  const [copiedSubject, setCopiedSubject] = useState("");

  // Tab 4: Copy Improver
  const [improveContent, setImproveContent] = useState("Hey everyone, we're really excited about our new skincare line and want you to try it out. We have a 20% off deal this week only.");
  const [improveMode, setImproveMode] = useState("rewrite");
  const [improveTone, setImproveTone] = useState("Professional");
  const [improveInstruction, setImproveInstruction] = useState("");
  const [improveResult, setImproveResult] = useState(null);
  const [improveLoading, setImproveLoading] = useState(false);
  const [improveError, setImproveError] = useState("");
  const [copiedImprove, setCopiedImprove] = useState(false);

  useEffect(() => {
    async function loadBrandVoice() {
      try {
        const data = await api("/ai/brand-voice");
        if (data?.brandVoice && data.brandVoice.brandName) {
          setBrandVoice(data.brandVoice);
          setBrandName(data.brandVoice.brandName);
          if (data.brandVoice.preferredTone) {
            setTone(data.brandVoice.preferredTone);
          }
        }
      } catch {
        // Silently continue if brand voice fails to load
      }
    }
    loadBrandVoice();
  }, []);

  async function generate() {
    setLoading(true);
    setError("");
    setSaveSuccess("");
    try {
      const data = await api("/ai/generate-email", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          purpose,
          tone,
          audience,
          brandName: brandName || "Your Brand",
          cta: cta || "Learn More",
          language: "English",
          useBrandVoice
        })
      });
      setResult(data.email);
      setAppliedBrandVoice(Boolean(data.appliedBrandVoice));
    } catch (e) {
      setError(e.message || "Failed to generate email.");
    } finally {
      setLoading(false);
    }
  }

  async function generatePersonalized() {
    setPersonalizeLoading(true);
    setPersonalizeError("");
    try {
      const tags = targetTags.split(",").map(t => t.trim()).filter(Boolean);
      const data = await api("/ai/generate-personalized", {
        method: "POST",
        body: JSON.stringify({
          prompt: personalizePrompt,
          purpose,
          tone,
          targetTags: tags,
          contactSample: {
            firstName: sampleFirstName.trim() || undefined,
            company: sampleCompany.trim() || undefined,
            tags
          },
          useBrandVoice
        })
      });
      setPersonalizeResult(data.email);
    } catch (e) {
      setPersonalizeError(e.message || "Failed to generate personalized email.");
    } finally {
      setPersonalizeLoading(false);
    }
  }

  async function saveTemplate(targetResult) {
    const toSave = targetResult || result;
    if (!toSave) return;
    try {
      await api("/templates", {
        method: "POST",
        body: JSON.stringify({
          name: toSave.headline || "AI email template",
          email: toSave
        })
      });
      setSaveSuccess("Template saved successfully to your Templates library!");
      setTimeout(() => setSaveSuccess(""), 4000);
    } catch (e) {
      alert(e.message || "Failed to save template.");
    }
  }

  async function generateSubjects() {
    if (!subjectContext.trim()) return;
    setSubjectLoading(true);
    setSubjectError("");
    try {
      const data = await api("/ai/suggest-subjects", {
        method: "POST",
        body: JSON.stringify({
          context: subjectContext.trim(),
          currentSubject: currentSubject.trim() || undefined,
          tone: subjectTone,
          count: 5,
          useBrandVoice
        })
      });
      setSubjectSuggestions(data.suggestions || []);
      setSubjectTopPick(data.improvedSubject || "");
    } catch (e) {
      setSubjectError(e.message || "Failed to generate subject lines.");
    } finally {
      setSubjectLoading(false);
    }
  }

  async function handleImprove() {
    if (!improveContent.trim()) return;
    setImproveLoading(true);
    setImproveError("");
    try {
      const data = await api("/ai/improve-content", {
        method: "POST",
        body: JSON.stringify({
          content: improveContent.trim(),
          mode: improveMode,
          tone: improveTone,
          instruction: improveInstruction.trim() || undefined,
          useBrandVoice
        })
      });
      setImproveResult(data);
    } catch (e) {
      setImproveError(e.message || "Failed to improve copy.");
    } finally {
      setImproveLoading(false);
    }
  }

  const html = result?.html || "";

  return (
    <div className="page-stack">
      <div className="welcome-row">
        <div>
          <span className="form-kicker">CREATE SOMETHING BRILLIANT</span>
          <h1>
            AI Email Studio <span className="ai-label"><Sparkles size={13} /> AI POWERED</span>
          </h1>
          <p className="muted">
            Turn ideas into complete campaigns, personalized for audience segments and aligned with your workspace brand voice.
          </p>
        </div>

        {brandVoice?.brandName && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              background: useBrandVoice ? "#f3f0ff" : "#f1f2f5",
              border: `1px solid ${useBrandVoice ? "#d5cbf5" : "#e0e2e8"}`,
              padding: "8px 14px",
              borderRadius: "20px",
              fontSize: "11px",
              fontWeight: "600",
              color: useBrandVoice ? "#6545bc" : "#808594"
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", margin: 0 }}>
              <input
                type="checkbox"
                checked={useBrandVoice}
                onChange={e => setUseBrandVoice(e.target.checked)}
                style={{ width: "auto", margin: 0 }}
              />
              <span>Brand Voice: <b>{brandVoice.brandName}</b></span>
            </label>
            {useBrandVoice && (
              <span className="chip" style={{ padding: "2px 6px", fontSize: "9px", background: "#fff", borderColor: "#cbbff0" }}>
                Active ({brandVoice.preferredTone || "Professional"})
              </span>
            )}
          </div>
        )}
      </div>

      {/* STUDIO TABS */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          borderBottom: "1px solid #eceef4",
          paddingBottom: "12px",
          marginBottom: "18px",
          flexWrap: "wrap"
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("generator")}
          className={`soft-button ${activeTab === "generator" ? "active" : ""}`}
          style={{
            padding: "8px 16px",
            fontSize: "12px",
            fontWeight: "700",
            background: activeTab === "generator" ? "#f3f0ff" : "#fff",
            color: activeTab === "generator" ? "#6545bc" : "#60677a",
            borderColor: activeTab === "generator" ? "#d5cbf5" : "#e9eaf1"
          }}
        >
          <WandSparkles size={14} /> Full Email Generator
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("personalize")}
          className={`soft-button ${activeTab === "personalize" ? "active" : ""}`}
          style={{
            padding: "8px 16px",
            fontSize: "12px",
            fontWeight: "700",
            background: activeTab === "personalize" ? "#f3f0ff" : "#fff",
            color: activeTab === "personalize" ? "#6545bc" : "#60677a",
            borderColor: activeTab === "personalize" ? "#d5cbf5" : "#e9eaf1"
          }}
        >
          <Users size={14} /> Audience Personalization
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("subjects")}
          className={`soft-button ${activeTab === "subjects" ? "active" : ""}`}
          style={{
            padding: "8px 16px",
            fontSize: "12px",
            fontWeight: "700",
            background: activeTab === "subjects" ? "#f3f0ff" : "#fff",
            color: activeTab === "subjects" ? "#6545bc" : "#60677a",
            borderColor: activeTab === "subjects" ? "#d5cbf5" : "#e9eaf1"
          }}
        >
          <Lightbulb size={14} /> Subject Line Studio
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("improver")}
          className={`soft-button ${activeTab === "improver" ? "active" : ""}`}
          style={{
            padding: "8px 16px",
            fontSize: "12px",
            fontWeight: "700",
            background: activeTab === "improver" ? "#f3f0ff" : "#fff",
            color: activeTab === "improver" ? "#6545bc" : "#60677a",
            borderColor: activeTab === "improver" ? "#d5cbf5" : "#e9eaf1"
          }}
        >
          <FileEdit size={14} /> Copy Improver
        </button>
      </div>

      {saveSuccess && (
        <div style={{ background: "#e9f8f1", color: "#269769", padding: "10px 18px", borderRadius: "8px", fontSize: "12px", fontWeight: "600", marginBottom: "14px" }}>
          ✓ {saveSuccess}
        </div>
      )}

      {/* TAB 1: FULL EMAIL GENERATOR */}
      {activeTab === "generator" && (
        <div className="studio-layout">
          <div className="panel prompt-panel">
            <div className="panel-heading">
              <div>
                <h3><WandSparkles size={18} /> Tell us what to create</h3>
                <p>Be as descriptive as you like. AI will handle the structure, sections, and copy.</p>
              </div>
            </div>

            <label className="field-label">
              Campaign description *
              <textarea
                rows="6"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Describe your email campaign..."
              />
            </label>

            <div className="form-two">
              <label className="field-label">
                Email purpose
                <select value={purpose} onChange={e => setPurpose(e.target.value)}>
                  {PURPOSES.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              <label className="field-label">
                Writing tone
                <select value={tone} onChange={e => setTone(e.target.value)}>
                  {TONES.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
            </div>

            <div className="form-two">
              <label className="field-label">
                Target audience
                <select value={audience} onChange={e => setAudience(e.target.value)}>
                  {AUDIENCES.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              <label className="field-label">
                Call to action label
                <input
                  value={cta}
                  onChange={e => setCta(e.target.value)}
                  placeholder="e.g. Shop Collection"
                />
              </label>
            </div>

            <div className="form-two">
              <label className="field-label">
                Brand / Company name
                <input
                  value={brandName}
                  onChange={e => setBrandName(e.target.value)}
                  placeholder="Your Brand"
                />
              </label>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", fontWeight: "700", color: "#4e5568", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={useBrandVoice}
                    onChange={e => setUseBrandVoice(e.target.checked)}
                    style={{ width: "auto", margin: 0 }}
                  />
                  <span>Apply Workspace Brand Voice</span>
                </label>
                <small className="muted" style={{ fontSize: "10px", marginTop: "4px" }}>
                  Injects brand personality, preferred vocabulary, and blocks prohibited phrases.
                </small>
              </div>
            </div>

            <button
              className="primary-button full generate-button"
              onClick={generate}
              disabled={loading || !prompt.trim()}
            >
              {loading ? (
                <><RefreshCw className="spin" size={17} /> Creating your email...</>
              ) : (
                <><Sparkles size={17} /> Generate complete email <ArrowRight size={17} /></>
              )}
            </button>

            {error && <div className="error-box">{error}</div>}
          </div>

          <div className="panel preview-panel">
            <div className="preview-toolbar">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <h3 style={{ margin: 0 }}>Email preview</h3>
                  {appliedBrandVoice && (
                    <span className="chip" style={{ padding: "2px 6px", fontSize: "9px", background: "#f0edfc", color: "#6545bc" }}>
                      ★ Brand Voice Applied
                    </span>
                  )}
                </div>
                <p>{result ? "AI-generated structured email" : "Your design will appear here"}</p>
              </div>
              <div className="preview-actions">
                <button className={`icon-button ${!mobile ? "selected" : ""}`} onClick={() => setMobile(false)} title="Desktop">
                  <Monitor size={17} />
                </button>
                <button className={`icon-button ${mobile ? "selected" : ""}`} onClick={() => setMobile(true)} title="Mobile">
                  <Smartphone size={17} />
                </button>
              </div>
            </div>

            {!result ? (
              <div className="empty-preview">
                <div className="empty-icon"><Sparkles size={26} /></div>
                <h3>Your next great email starts here</h3>
                <p>Describe your campaign and click Generate. Your complete email will appear in this preview.</p>
              </div>
            ) : (
              <div className="email-canvas-wrap">
                <div className={`email-canvas ${mobile ? "mobile-preview" : ""}`}>
                  <div className="email-brand">{brandName.toUpperCase()}</div>
                  <div className="email-hero">
                    <span>{purpose.toUpperCase()}</span>
                    <h1>{result.headline}</h1>
                    <p>{result.previewText}</p>
                  </div>
                  {result.sections?.map((s, i) => (
                    <div className="email-section" key={i}>
                      <h2>{s.heading}</h2>
                      <p>{s.body}</p>
                    </div>
                  ))}
                  <div className="email-cta">
                    <a href="#">{result.ctaText || cta}</a>
                  </div>
                  <div className="email-footer">
                    {result.footer}<br />
                    <small>You are receiving this email because you subscribed to updates. Unsubscribe</small>
                  </div>
                </div>
              </div>
            )}

            {result && (
              <div className="result-actions">
                <button className="soft-button" onClick={() => navigator.clipboard.writeText(html)}>
                  <Copy size={15} /> Copy HTML
                </button>
                <button className="soft-button" onClick={() => saveTemplate(result)}>
                  <Save size={15} /> Save template
                </button>
                <button className="soft-button" onClick={() => setResult(null)}>
                  <RefreshCw size={15} /> New generation
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: AUDIENCE PERSONALIZATION */}
      {activeTab === "personalize" && (
        <div className="studio-layout">
          <div className="panel prompt-panel">
            <div className="panel-heading">
              <div>
                <h3><Users size={18} /> Audience Segment Personalization</h3>
                <p>Tailor email messaging, value propositions, and dynamic placeholders for specific contact segments.</p>
              </div>
            </div>

            <label className="field-label">
              Campaign message & focus *
              <textarea
                rows="5"
                value={personalizePrompt}
                onChange={e => setPersonalizePrompt(e.target.value)}
                placeholder="What is this campaign offering to this segment?"
              />
            </label>

            <label className="field-label">
              Target Segment Tags (comma-separated)
              <input
                value={targetTags}
                onChange={e => setTargetTags(e.target.value)}
                placeholder="e.g. VIP, Enterprise, Free-Trial, Churn-Risk"
              />
            </label>

            <div className="form-two">
              <label className="field-label">
                Sample First Name (Preview)
                <input
                  value={sampleFirstName}
                  onChange={e => setSampleFirstName(e.target.value)}
                  placeholder="e.g. Alex"
                />
              </label>
              <label className="field-label">
                Sample Company (Preview)
                <input
                  value={sampleCompany}
                  onChange={e => setSampleCompany(e.target.value)}
                  placeholder="e.g. TechNova"
                />
              </label>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", fontWeight: "700", color: "#4e5568", cursor: "pointer", marginBottom: "16px" }}>
              <input
                type="checkbox"
                checked={useBrandVoice}
                onChange={e => setUseBrandVoice(e.target.checked)}
                style={{ width: "auto", margin: 0 }}
              />
              <span>Incorporate Workspace Brand Voice ({brandVoice?.preferredTone || "Professional"})</span>
            </label>

            <button
              className="primary-button full generate-button"
              onClick={generatePersonalized}
              disabled={personalizeLoading || !personalizePrompt.trim()}
            >
              {personalizeLoading ? (
                <><RefreshCw className="spin" size={17} /> Personalizing for audience...</>
              ) : (
                <><Users size={17} /> Generate Personalized Email <ArrowRight size={17} /></>
              )}
            </button>

            {personalizeError && <div className="error-box">{personalizeError}</div>}
          </div>

          <div className="panel preview-panel">
            <div className="preview-toolbar">
              <div>
                <h3>Personalized Preview</h3>
                <p>{personalizeResult ? "Targeted draft with dynamic placeholders" : "Your personalized design will appear here"}</p>
              </div>
            </div>

            {!personalizeResult ? (
              <div className="empty-preview">
                <div className="empty-icon"><Users size={26} /></div>
                <h3>Audience-first messaging</h3>
                <p>Specify audience segment tags and preview attributes. AI will craft relevant headlines, personalized greetings, and tailored value propositions.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "14px" }}>
                <div style={{ background: "#f8f9fe", padding: "12px 14px", borderRadius: "8px", border: "1px solid #eceef4", fontSize: "12px" }}>
                  <div><b>Subject:</b> {personalizeResult.subject}</div>
                  <div style={{ color: "#747a8c", marginTop: "2px" }}><b>Preheader:</b> {personalizeResult.previewText}</div>
                </div>

                <div className="email-canvas-wrap" style={{ margin: 0 }}>
                  <div className="email-canvas">
                    <div className="email-brand">{brandName.toUpperCase()}</div>
                    <div className="email-hero">
                      <span>TARGETED SEGMENT: {targetTags.toUpperCase()}</span>
                      <h1>{personalizeResult.headline}</h1>
                      <p>{personalizeResult.previewText}</p>
                    </div>
                    {personalizeResult.sections?.map((s, i) => (
                      <div className="email-section" key={i}>
                        <h2>{s.heading}</h2>
                        <p>{s.body}</p>
                      </div>
                    ))}
                    <div className="email-cta">
                      <a href="#">{personalizeResult.ctaText || "Explore"}</a>
                    </div>
                  </div>
                </div>

                <div className="result-actions">
                  <button className="soft-button" onClick={() => navigator.clipboard.writeText(personalizeResult.html)}>
                    <Copy size={15} /> Copy HTML
                  </button>
                  <button className="soft-button" onClick={() => saveTemplate(personalizeResult)}>
                    <Save size={15} /> Save template
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: SUBJECT LINE STUDIO */}
      {activeTab === "subjects" && (
        <div className="studio-layout">
          <div className="panel prompt-panel">
            <div className="panel-heading">
              <div>
                <h3><Lightbulb size={18} /> High-Converting Subject Lines</h3>
                <p>Generate tested, spam-compliant subject line variations that boost open rates.</p>
              </div>
            </div>

            <label className="field-label">
              Campaign context & offer *
              <textarea
                rows="6"
                value={subjectContext}
                onChange={e => setSubjectContext(e.target.value)}
                placeholder="What is your email about? Key announcement, discount, or launch details..."
              />
            </label>

            <label className="field-label">
              Current subject line (Optional)
              <input
                value={currentSubject}
                onChange={e => setCurrentSubject(e.target.value)}
                placeholder="Current subject line you want to improve..."
              />
            </label>

            <div className="form-two">
              <label className="field-label">
                Writing tone
                <select value={subjectTone} onChange={e => setSubjectTone(e.target.value)}>
                  {TONES.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              <div style={{ display: "flex", alignItems: "center", marginTop: "16px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: "700", color: "#4e5568", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={useBrandVoice}
                    onChange={e => setUseBrandVoice(e.target.checked)}
                    style={{ width: "auto", margin: 0 }}
                  />
                  <span>Match Brand Voice</span>
                </label>
              </div>
            </div>

            <button
              className="primary-button full generate-button"
              onClick={generateSubjects}
              disabled={subjectLoading || !subjectContext.trim()}
            >
              {subjectLoading ? (
                <><RefreshCw className="spin" size={17} /> Generating ideas...</>
              ) : (
                <><Lightbulb size={17} /> Suggest 5 subject lines <ArrowRight size={17} /></>
              )}
            </button>

            {subjectError && <div className="error-box">{subjectError}</div>}
          </div>

          <div className="panel preview-panel">
            <div className="preview-toolbar">
              <div>
                <h3>Subject Line Suggestions</h3>
                <p>{subjectSuggestions.length > 0 ? "Click any suggestion to copy" : "Generated options will appear here"}</p>
              </div>
            </div>

            {subjectSuggestions.length === 0 ? (
              <div className="empty-preview">
                <div className="empty-icon"><Lightbulb size={26} /></div>
                <h3>Explore subject variations</h3>
                <p>Enter your campaign details and generate 5 subject lines categorized by style (Benefit, Curiosity, Urgent, Question).</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
                {subjectTopPick && (
                  <div style={{ background: "#f5f0ff", border: "1px solid #e1d5fd", padding: "12px 16px", borderRadius: "8px" }}>
                    <span style={{ fontSize: "10px", fontWeight: "800", color: "#6545bc", letterSpacing: "1px" }}>★ TOP RECOMMENDATION</span>
                    <div style={{ fontSize: "14px", fontWeight: "700", color: "#282a36", marginTop: "3px" }}>{subjectTopPick}</div>
                  </div>
                )}

                {subjectSuggestions.map((s, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: "1px solid #eceef4",
                      borderRadius: "8px",
                      padding: "14px 16px",
                      background: "#fafbfe",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "12px"
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ fontSize: "13px", fontWeight: "700", color: "#1e2530" }}>{s.subject}</span>
                        {s.style && (
                          <span className="chip" style={{ padding: "2px 6px", fontSize: "9px", background: "#f0edfc", color: "#6545bc", borderColor: "#e1d7fc" }}>
                            {s.style}
                          </span>
                        )}
                      </div>
                      {s.previewText && (
                        <p style={{ margin: 0, fontSize: "11px", color: "#747a8c", lineHeight: "1.4" }}>
                          <b>Preheader:</b> {s.previewText}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      className="soft-button"
                      onClick={() => {
                        navigator.clipboard.writeText(s.subject);
                        setCopiedSubject(s.subject);
                        setTimeout(() => setCopiedSubject(""), 2500);
                      }}
                    >
                      {copiedSubject === s.subject ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: COPY IMPROVER */}
      {activeTab === "improver" && (
        <div className="studio-layout">
          <div className="panel prompt-panel">
            <div className="panel-heading">
              <div>
                <h3><FileEdit size={18} /> Polish & Optimize Email Copy</h3>
                <p>Enhance clarity, tighten paragraphs, adjust tone, or eliminate typos with targeted improvements.</p>
              </div>
            </div>

            <label className="field-label">
              Copy to improve *
              <textarea
                rows="7"
                value={improveContent}
                onChange={e => setImproveContent(e.target.value)}
                placeholder="Paste the email content or paragraph you want to polish..."
              />
            </label>

            <div className="form-two">
              <label className="field-label">
                Improvement goal
                <select value={improveMode} onChange={e => setImproveMode(e.target.value)}>
                  <option value="rewrite">Rewrite & Polish</option>
                  <option value="shorten">Condense & Shorten</option>
                  <option value="expand">Add Detail & Depth</option>
                  <option value="clarify">Improve Clarity</option>
                  <option value="change_tone">Adjust Tone</option>
                  <option value="fix_grammar">Fix Grammar & Typos</option>
                  <option value="improve_cta">Optimize Call to Action</option>
                </select>
              </label>
              <label className="field-label">
                Writing tone
                <select value={improveTone} onChange={e => setImproveTone(e.target.value)}>
                  {TONES.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
            </div>

            <label className="field-label">
              Specific instructions (Optional)
              <input
                value={improveInstruction}
                onChange={e => setImproveInstruction(e.target.value)}
                placeholder="e.g. keep under 50 words, emphasize limited availability"
              />
            </label>

            <div style={{ marginBottom: "16px" }}>
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
              className="primary-button full generate-button"
              onClick={handleImprove}
              disabled={improveLoading || !improveContent.trim()}
            >
              {improveLoading ? (
                <><RefreshCw className="spin" size={17} /> Improving copy...</>
              ) : (
                <><Sparkles size={17} /> Improve copy <ArrowRight size={17} /></>
              )}
            </button>

            {improveError && <div className="error-box">{improveError}</div>}
          </div>

          <div className="panel preview-panel">
            <div className="preview-toolbar">
              <div>
                <h3>Improved Result</h3>
                <p>{improveResult ? "Side-by-side revised content" : "Revised text will appear here"}</p>
              </div>
            </div>

            {!improveResult ? (
              <div className="empty-preview">
                <div className="empty-icon"><FileEdit size={26} /></div>
                <h3>Polished copy in seconds</h3>
                <p>Paste any section of email text and choose your goal. AI will suggest clean, engaging alternatives aligned with your voice.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "16px" }}>
                <div style={{ background: "#eef8f2", color: "#228b57", padding: "10px 14px", borderRadius: "8px", fontSize: "11px", fontWeight: "600" }}>
                  ✓ {improveResult.changesSummary}
                </div>

                <label className="field-label">
                  Improved Copy
                  <textarea
                    rows="9"
                    value={improveResult.improvedContent}
                    onChange={e => setImproveResult(prev => ({ ...prev, improvedContent: e.target.value }))}
                    style={{ fontSize: "13px", lineHeight: "1.6" }}
                  />
                </label>

                <div className="result-actions">
                  <button
                    className="soft-button"
                    onClick={() => {
                      navigator.clipboard.writeText(improveResult.improvedContent);
                      setCopiedImprove(true);
                      setTimeout(() => setCopiedImprove(false), 2500);
                    }}
                  >
                    {copiedImprove ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy to Clipboard</>}
                  </button>
                  <button className="soft-button" onClick={() => setImproveResult(null)}>
                    <RefreshCw size={14} /> Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
