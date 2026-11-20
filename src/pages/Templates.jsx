import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  LayoutTemplate,
  Plus,
  Search,
  Eye,
  Edit3,
  Copy,
  Trash2,
  Sparkles,
  Monitor,
  Smartphone,
  Check,
  AlertCircle,
  X,
  Filter,
  Send,
  Layers,
  ArrowRight,
  RefreshCw,
  Code2
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../state/AuthContext";
import { sanitizeHtml, applySamplePlaceholders } from "../components/EmailEditor";

const CATEGORIES = [
  "All",
  "Welcome",
  "Newsletter",
  "Promotional",
  "Product Launch",
  "Announcement",
  "Event Invitation",
  "Follow-up",
  "Custom"
];

const DEFAULT_BLANK_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Template</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f8fb; font-family: sans-serif; color: #20243a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; padding: 40px; max-width: 600px;">
          <tr>
            <td>
              <h1 style="color: #6545bc; font-size: 24px; margin-top: 0;">Hello {{firstName}}!</h1>
              <p style="font-size: 15px; line-height: 1.6; color: #4e5568;">
                Write your email content here. You can use personalization tags like {{firstName}}, {{lastName}}, and {{company}}.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td align="center">
                    <a href="https://example.com" style="background-color: #6545bc; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px;">Take Action →</a>
                  </td>
                </tr>
              </table>
              <hr style="border: 0; border-top: 1px solid #f0f1f5; margin: 32px 0 20px;">
              <p style="font-size: 12px; color: #8b91a3; text-align: center; margin: 0;">
                {{company}} · {{unsubscribe}}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

export default function Templates() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canEdit = user && ["OWNER", "ADMIN", "EDITOR"].includes(user.role || "OWNER");

  const [templates, setTemplates] = useState([]);
  const [starters, setStarters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [viewTab, setViewTab] = useState("workspace"); // 'workspace' | 'starters'

  // Modals state
  const [modalMode, setModalMode] = useState(""); // '' | 'edit' | 'preview' | 'delete'
  const [activeTemplate, setActiveTemplate] = useState(null);

  // Form state for creating/editing
  const [form, setForm] = useState({
    name: "",
    category: "Custom",
    subject: "",
    previewText: "",
    html: DEFAULT_BLANK_HTML
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Preview viewport state
  const [previewDevice, setPreviewDevice] = useState("desktop"); // 'desktop' | 'mobile'

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tmplRes, startersRes] = await Promise.all([
        api("/templates"),
        api("/templates/starters").catch(() => ({ starters: [] }))
      ]);
      setTemplates(tmplRes.templates || []);
      setStarters(startersRes.starters || []);
    } catch (err) {
      console.error("Failed to fetch templates:", err);
      setError(err.message || "Failed to load templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Filter templates based on search & category
  const filteredTemplates = useMemo(() => {
    const list = viewTab === "starters" ? starters : templates;
    return list.filter((t) => {
      const matchesSearch =
        !search.trim() ||
        t.name?.toLowerCase().includes(search.toLowerCase()) ||
        t.subject?.toLowerCase().includes(search.toLowerCase());

      const matchesCategory =
        selectedCategory === "All" ||
        (t.category && t.category.toLowerCase() === selectedCategory.toLowerCase());

      return matchesSearch && matchesCategory;
    });
  }, [templates, starters, viewTab, search, selectedCategory]);

  // Open Create Modal from Scratch
  const handleOpenCreate = () => {
    setForm({
      name: "",
      category: "Custom",
      subject: "",
      previewText: "",
      html: DEFAULT_BLANK_HTML
    });
    setActiveTemplate(null);
    setFormError("");
    setModalMode("edit");
  };

  // Open Create Modal pre-filled from Starter Template
  const handleUseStarter = (starter) => {
    setForm({
      name: `${starter.name}`,
      category: starter.category || "Custom",
      subject: starter.subject || "",
      previewText: starter.previewText || "",
      html: starter.html || DEFAULT_BLANK_HTML
    });
    setActiveTemplate(null);
    setFormError("");
    setModalMode("edit");
  };

  // Open Edit Modal
  const handleOpenEdit = (template) => {
    setActiveTemplate(template);
    setForm({
      name: template.name || "",
      category: template.category || "Custom",
      subject: template.subject || "",
      previewText: template.previewText || "",
      html: template.html || ""
    });
    setFormError("");
    setModalMode("edit");
  };

  // Open Preview Modal
  const handleOpenPreview = (template) => {
    setActiveTemplate(template);
    setPreviewDevice("desktop");
    setModalMode("preview");
  };

  // Open Delete Confirmation Modal
  const handleOpenDelete = (template) => {
    setActiveTemplate(template);
    setModalMode("delete");
  };

  // Save (Create or Update)
  const handleSaveTemplate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError("Template name is required.");
      return;
    }
    if (!form.html.trim()) {
      setFormError("Template HTML cannot be empty.");
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      if (activeTemplate?.id) {
        // Update existing
        await api(`/templates/${activeTemplate.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name.trim(),
            category: form.category,
            subject: form.subject.trim(),
            previewText: form.previewText.trim() || null,
            html: form.html
          })
        });
        setNotice(`Template "${form.name}" updated successfully.`);
      } else {
        // Create new
        await api("/templates", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            category: form.category,
            subject: form.subject.trim(),
            previewText: form.previewText.trim() || null,
            html: form.html
          })
        });
        setNotice(`Template "${form.name}" created successfully.`);
        setViewTab("workspace");
      }

      setModalMode("");
      await fetchTemplates();
      setTimeout(() => setNotice(""), 3500);
    } catch (err) {
      setFormError(err.message || "Failed to save template.");
    } finally {
      setSaving(false);
    }
  };

  // Duplicate Template
  const handleDuplicate = async (template) => {
    try {
      const res = await api(`/templates/${template.id}/duplicate`, {
        method: "POST"
      });
      setNotice(res.message || "Template duplicated successfully.");
      await fetchTemplates();
      setTimeout(() => setNotice(""), 3500);
    } catch (err) {
      setError(err.message || "Failed to duplicate template.");
    }
  };

  // Delete Template
  const handleDeleteConfirm = async () => {
    if (!activeTemplate) return;
    setSaving(true);
    try {
      await api(`/templates/${activeTemplate.id}`, {
        method: "DELETE"
      });
      setNotice(`Template "${activeTemplate.name}" deleted.`);
      setModalMode("");
      await fetchTemplates();
      setTimeout(() => setNotice(""), 3500);
    } catch (err) {
      setError(err.message || "Failed to delete template.");
      setModalMode("");
    } finally {
      setSaving(false);
    }
  };

  // Create campaign with this template
  const handleCreateCampaignFromTemplate = (template) => {
    navigate("/app/campaigns", {
      state: {
        initialTemplateId: template.id,
        initialSubject: template.subject,
        initialPreviewText: template.previewText,
        initialHtml: template.html,
        initialName: `Campaign - ${template.name}`
      }
    });
  };

  return (
    <div className="page-stack template-management-page">
      {/* 1. Header Row */}
      <div className="page-title-row">
        <div>
          <span className="eyebrow">DESIGN & ASSETS</span>
          <h1>Email Templates</h1>
          <p className="muted">
            Design, organize, and reuse mobile-responsive email templates across your marketing campaigns.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          {/* View Tab Selector */}
          <div style={{ display: "inline-flex", background: "#f0f1f5", borderRadius: "8px", padding: "3px" }}>
            <button
              className={`soft-button ${viewTab === "workspace" ? "chip-active" : ""}`}
              style={{ padding: "6px 12px", border: 0, fontSize: "11px" }}
              onClick={() => setViewTab("workspace")}
            >
              <Layers size={13} style={{ marginRight: 5 }} />
              My Templates ({templates.length})
            </button>
            <button
              className={`soft-button ${viewTab === "starters" ? "chip-active" : ""}`}
              style={{ padding: "6px 12px", border: 0, fontSize: "11px" }}
              onClick={() => setViewTab("starters")}
            >
              <Sparkles size={13} style={{ marginRight: 5 }} />
              Starter Gallery ({starters.length})
            </button>
          </div>

          {canEdit && (
            <button className="primary-button" onClick={handleOpenCreate}>
              <Plus size={16} /> New Template
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {notice && (
        <div className="notice" style={{ background: "#e9f8f1", color: "#2caa76", border: "1px solid #d1f2e1" }}>
          <Check size={16} />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="error-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button className="soft-button" onClick={() => setError(null)} style={{ padding: "3px 6px" }}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* 2. Filters & Search Toolbar */}
      <div className="panel" style={{ padding: "14px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", flexWrap: "wrap" }}>
          {/* Search */}
          <div className="search-box" style={{ minWidth: "260px" }}>
            <Search size={15} />
            <input
              placeholder="Search templates by name or subject..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          {/* Category Chips */}
          <div className="action-chips" style={{ overflowX: "auto", paddingBottom: "2px" }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                className={`chip ${selectedCategory === cat ? "chip-active" : ""}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Template Cards Grid */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#7657d6" }}>
          <RefreshCw size={24} className="spin" style={{ marginBottom: 12 }} />
          <div>Loading email templates…</div>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="panel" style={{ textAlign: "center", padding: "64px 20px" }}>
          <LayoutTemplate size={48} color="#a0a5b2" style={{ marginBottom: "16px" }} />
          <h3>No templates found</h3>
          <p className="muted" style={{ maxWidth: "420px", margin: "8px auto 20px" }}>
            {viewTab === "workspace"
              ? "Your workspace doesn't have any templates matching this filter. Start with a starter template or design a new one."
              : "No starter templates match your current search criteria."}
          </p>
          {viewTab === "workspace" ? (
            <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
              <button className="soft-button" onClick={() => setViewTab("starters")}>
                <Sparkles size={14} /> Browse Starter Gallery
              </button>
              {canEdit && (
                <button className="primary-button" onClick={handleOpenCreate}>
                  <Plus size={14} /> Create Blank Template
                </button>
              )}
            </div>
          ) : (
            <button className="soft-button" onClick={() => { setSelectedCategory("All"); setSearch(""); }}>
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="template-grid">
          {filteredTemplates.map((t) => (
            <div key={t.id} className="template-card panel">
              {/* Card Header & Category Badge */}
              <div className="template-card-header">
                <span className="template-category-badge">{t.category || "Custom"}</span>
                {t._count?.campaigns !== undefined && (
                  <span className="muted" style={{ fontSize: "11px" }}>
                    Used in {t._count.campaigns} campaign{t._count.campaigns === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              {/* Title & Subject */}
              <div className="template-card-body">
                <h3 className="template-card-title">{t.name}</h3>
                <p className="template-card-subject">
                  <b>Subject:</b> {t.subject || "No subject specified"}
                </p>
                {t.description && (
                  <p className="template-card-desc">{t.description}</p>
                )}
              </div>

              {/* Mini Preview Box */}
              <div className="template-card-preview" onClick={() => handleOpenPreview(t)} title="Click to view full preview">
                <iframe
                  title={`preview-${t.id}`}
                  srcDoc={sanitizeHtml(applySamplePlaceholders(t.html))}
                  sandbox="allow-same-origin"
                  className="template-preview-frame"
                />
                <div className="template-preview-overlay">
                  <Eye size={16} /> Click to preview
                </div>
              </div>

              {/* Card Actions */}
              <div className="template-card-actions">
                <button className="soft-button" onClick={() => handleOpenPreview(t)} title="Preview across desktop & mobile">
                  <Eye size={13} /> Preview
                </button>

                {viewTab === "workspace" ? (
                  <>
                    {canEdit && (
                      <button className="soft-button" onClick={() => handleOpenEdit(t)} title="Edit template content">
                        <Edit3 size={13} /> Edit
                      </button>
                    )}
                    {canEdit && (
                      <button className="soft-button" onClick={() => handleDuplicate(t)} title="Duplicate template">
                        <Copy size={13} />
                      </button>
                    )}
                    <button
                      className="primary-button"
                      style={{ padding: "7px 11px", fontSize: "11px", marginLeft: "auto" }}
                      onClick={() => handleCreateCampaignFromTemplate(t)}
                      title="Create a new campaign using this template"
                    >
                      <Send size={12} /> Use in Campaign
                    </button>
                    {canEdit && (
                      <button className="soft-button" style={{ color: "#c34a4a" }} onClick={() => handleOpenDelete(t)} title="Delete template">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    className="primary-button"
                    style={{ padding: "7px 13px", fontSize: "11px", marginLeft: "auto" }}
                    onClick={() => handleUseStarter(t)}
                    title="Use this starter template to create a new workspace template"
                  >
                    <Sparkles size={13} /> Create from Starter
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* =========================================================================
          MODAL 1: TEMPLATE EDITOR (CREATE / EDIT)
          ========================================================================= */}
      {modalMode === "edit" && (
        <div className="modal-backdrop">
          <div className="modal template-editor-modal" style={{ width: "min(100%, 1080px)", maxHeight: "94vh" }}>
            <div className="modal-head">
              <div>
                <h2>{activeTemplate ? `Edit Template: ${activeTemplate.name}` : "Create Email Template"}</h2>
                <p className="muted" style={{ fontSize: "11px", marginTop: "2px" }}>
                  Compose reusable layout, subject lines, and personalized markup.
                </p>
              </div>
              <button className="icon-button" onClick={() => setModalMode("")}>
                <X size={18} />
              </button>
            </div>

            {formError && <div className="error-box" style={{ marginBottom: "16px" }}>{formError}</div>}

            <form onSubmit={handleSaveTemplate} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="form-two">
                <label className="field-label">
                  Template Name *
                  <input
                    placeholder="e.g. Monthly Newsletter v2"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </label>

                <label className="field-label">
                  Category
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  >
                    {CATEGORIES.filter((c) => c !== "All").map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="form-two">
                <label className="field-label">
                  Default Subject Line
                  <input
                    placeholder="e.g. Exclusive updates for {{firstName}}"
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  />
                </label>

                <label className="field-label">
                  Inbox Preview Snippet
                  <input
                    placeholder="e.g. Short summary shown in inbox preview"
                    value={form.previewText}
                    onChange={(e) => setForm({ ...form, previewText: e.target.value })}
                  />
                </label>
              </div>

              {/* Personalization Tag Insert helper chips */}
              <div>
                <span className="muted" style={{ fontSize: "11px", display: "block", marginBottom: "6px" }}>
                  Insert personalization tags:
                </span>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {["{{firstName}}", "{{lastName}}", "{{email}}", "{{company}}", "{{unsubscribe}}"].map((tag) => (
                    <button
                      type="button"
                      key={tag}
                      className="chip"
                      style={{ padding: "4px 8px", fontSize: "10px" }}
                      onClick={() => setForm({ ...form, html: form.html + tag })}
                    >
                      + {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* HTML Editor Textarea */}
              <label className="field-label" style={{ marginBottom: "0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>HTML Content *</span>
                  <span className="muted" style={{ fontSize: "10px" }}>Fully sanitized on render</span>
                </div>
                <textarea
                  rows={14}
                  style={{ fontFamily: "monospace", fontSize: "12px", lineHeight: "1.5" }}
                  value={form.html}
                  onChange={(e) => setForm({ ...form, html: e.target.value })}
                  required
                />
              </label>

              <div className="modal-actions">
                <button type="button" className="soft-button" onClick={() => setModalMode("")}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? "Saving…" : activeTemplate ? "Update Template" : "Save Template"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: TEMPLATE PREVIEW MODAL (DESKTOP & MOBILE)
          ========================================================================= */}
      {modalMode === "preview" && activeTemplate && (
        <div className="modal-backdrop">
          <div className="modal" style={{ width: "min(100%, 960px)", height: "90vh", display: "flex", flexDirection: "column", padding: "0" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #eceef4", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff" }}>
              <div>
                <h3 style={{ fontSize: "16px", margin: 0 }}>{activeTemplate.name}</h3>
                <span className="muted" style={{ fontSize: "11px" }}>
                  Subject: <b>{activeTemplate.subject || "No subject"}</b>
                </span>
              </div>

              {/* Device Toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ display: "inline-flex", background: "#f0f1f5", borderRadius: "8px", padding: "3px" }}>
                  <button
                    className={`soft-button ${previewDevice === "desktop" ? "chip-active" : ""}`}
                    style={{ padding: "5px 10px", fontSize: "11px", border: 0 }}
                    onClick={() => setPreviewDevice("desktop")}
                  >
                    <Monitor size={13} style={{ marginRight: 4 }} /> Desktop (600px)
                  </button>
                  <button
                    className={`soft-button ${previewDevice === "mobile" ? "chip-active" : ""}`}
                    style={{ padding: "5px 10px", fontSize: "11px", border: 0 }}
                    onClick={() => setPreviewDevice("mobile")}
                  >
                    <Smartphone size={13} style={{ marginRight: 4 }} /> Mobile (360px)
                  </button>
                </div>

                <button className="icon-button" onClick={() => setModalMode("")}>
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Preview Canvas */}
            <div style={{ flex: 1, overflowY: "auto", background: "#f4f5f8", padding: "24px", display: "flex", justifyContent: "center" }}>
              <div
                style={{
                  width: previewDevice === "mobile" ? "360px" : "600px",
                  background: "#ffffff",
                  borderRadius: "8px",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
                  overflow: "hidden",
                  transition: "width 0.2s ease"
                }}
              >
                <div
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(applySamplePlaceholders(activeTemplate.html))
                  }}
                />
              </div>
            </div>

            {/* Footer Actions */}
            <div style={{ padding: "14px 20px", borderTop: "1px solid #eceef4", background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="muted" style={{ fontSize: "11px" }}>
                Personalization preview tags shown with Jane Doe (Acme Corp).
              </span>

              <div style={{ display: "flex", gap: "8px" }}>
                {canEdit && activeTemplate.workspaceId && (
                  <button className="soft-button" onClick={() => handleOpenEdit(activeTemplate)}>
                    <Edit3 size={13} /> Edit Template
                  </button>
                )}
                {activeTemplate.workspaceId ? (
                  <button className="primary-button" onClick={() => handleCreateCampaignFromTemplate(activeTemplate)}>
                    <Send size={13} /> Use in Campaign
                  </button>
                ) : (
                  <button className="primary-button" onClick={() => handleUseStarter(activeTemplate)}>
                    <Sparkles size={13} /> Create from Starter
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 3: DELETE CONFIRMATION MODAL
          ========================================================================= */}
      {modalMode === "delete" && activeTemplate && (
        <div className="modal-backdrop">
          <div className="modal" style={{ width: "min(100%, 460px)" }}>
            <div className="modal-head">
              <h2>Delete Template?</h2>
              <button className="icon-button" onClick={() => setModalMode("")}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: "13px", color: "#60677a", lineHeight: 1.6 }}>
              Are you sure you want to delete <b>"{activeTemplate.name}"</b>? Any draft campaigns using this template will be safely unlinked. Existing sent campaigns will remain intact.
            </p>

            <div className="modal-actions">
              <button type="button" className="soft-button" onClick={() => setModalMode("")} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                style={{ background: "#c34a4a" }}
                onClick={handleDeleteConfirm}
                disabled={saving}
              >
                {saving ? "Deleting…" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
