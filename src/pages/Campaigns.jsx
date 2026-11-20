import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Search, Eye, Edit3, Trash2, X, Send, Users, Calendar, AlertCircle, Palette, Pause, Play, RefreshCw, LayoutTemplate, Monitor, Smartphone, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../state/AuthContext";
import EmailEditor, { sanitizeHtml, applySamplePlaceholders } from "../components/EmailEditor";
import CampaignOptimizerModal from "../components/CampaignOptimizerModal";

const canManageRole = role => ["OWNER", "ADMIN", "EDITOR"].includes(role);

const blankForm = {
  name: "",
  subject: "",
  previewText: "",
  fromName: "",
  fromEmail: "",
  description: "",
  templateId: "",
  targetTags: "",
  html: ""
};

function statusClass(status) {
  if (status === "DRAFT" || status === "SCHEDULED") return "status draft";
  if (status === "SENT" || status === "SENDING" || status === "QUEUED") return "status good";
  return "status muted-status";
}

export default function Campaigns() {
  const { user, workspace } = useAuth();
  const location = useLocation();
  const role = workspace?.role || user?.role || "VIEWER";
  const writable = canManageRole(role);

  const [campaigns, setCampaigns] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Modal states: "" | "edit" | "view"
  const [modal, setModal] = useState("");
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [optimizingCampaign, setOptimizingCampaign] = useState(null);
  const [activeEditorCampaign, setActiveEditorCampaign] = useState(null);
  const [scheduling, setScheduling] = useState(null);
  const [scheduledDateTime, setScheduledDateTime] = useState("");
  const [scheduleRecipientsCount, setScheduleRecipientsCount] = useState(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [recipientSample, setRecipientSample] = useState([]);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [previewingTemplate, setPreviewingTemplate] = useState(null);

  const [form, setForm] = useState(blankForm);
  const [templates, setTemplates] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);

  // Handle incoming template selection from Templates page navigation
  useEffect(() => {
    if (location.state?.initialTemplateId || location.state?.initialHtml) {
      setEditing(null);
      setForm({
        ...blankForm,
        name: location.state.initialName || "New Campaign",
        subject: location.state.initialSubject || "",
        previewText: location.state.initialPreviewText || "",
        templateId: location.state.initialTemplateId || "",
        html: location.state.initialHtml || ""
      });
      setModal("edit");
      loadAuxData();
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Load campaigns
  async function refresh() {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      limit: "20",
      ...(debounced ? { q: debounced } : {}),
      ...(status ? { status } : {})
    });

    try {
      const data = await api(`/campaigns?${params.toString()}`);
      setCampaigns(data.campaigns || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [page, debounced, status]);

  // Auto-refresh when any campaign is currently in SENDING state
  useEffect(() => {
    const isSending = campaigns.some(c => c.status === "SENDING");
    if (!isSending) return;
    const timer = setInterval(() => {
      refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [campaigns]);

  // Load auxiliary data (templates, tags) on demand
  async function loadAuxData() {
    try {
      const [tmplRes, tagsRes] = await Promise.all([
        api("/templates").catch(() => ({ templates: [] })),
        api("/contacts/tags").catch(() => ({ tags: [] }))
      ]);
      setTemplates(tmplRes.templates || []);
      setAvailableTags(tagsRes.tags || []);
    } catch {}
  }

  async function openEditor(campaign) {
    if (campaign.status !== "DRAFT") {
      setError("Only draft campaigns can be edited.");
      return;
    }
    setError("");
    try {
      if (templates.length === 0) {
        const tmplRes = await api("/templates").catch(() => ({ templates: [] }));
        setTemplates(tmplRes.templates || []);
      }
      const data = await api(`/campaigns/${campaign.id}`);
      setActiveEditorCampaign(data.campaign);
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveEditorContent({ subject, previewText, html, templateId }) {
    if (!activeEditorCampaign) return;
    const updated = await api(`/campaigns/${activeEditorCampaign.id}`, {
      method: "PATCH",
      body: JSON.stringify({ subject, previewText, html, templateId })
    });
    setActiveEditorCampaign(updated.campaign);
    await refresh();
  }

  function openCreate() {
    setEditing(null);
    setForm(blankForm);
    setError("");
    setNotice("");
    setModal("edit");
    loadAuxData();
  }

  function openEdit(campaign) {
    if (campaign.status !== "DRAFT") {
      setError("Only draft campaigns can be edited.");
      return;
    }
    setEditing(campaign);
    setForm({
      name: campaign.name || "",
      subject: campaign.subject || "",
      previewText: campaign.previewText || "",
      fromName: campaign.fromName || "",
      fromEmail: campaign.fromEmail || "",
      description: campaign.description || "",
      templateId: campaign.templateId || "",
      targetTags: (campaign.targetTags || []).join(", "),
      html: campaign.html || ""
    });
    setError("");
    setNotice("");
    setModal("edit");
    loadAuxData();
  }

  async function openView(campaign) {
    setError("");
    setViewing(campaign);
    setRecipientSample([]);
    setModal("view");
    setSampleLoading(true);

    try {
      // Fetch full campaign details with eligible recipient count
      const data = await api(`/campaigns/${campaign.id}`);
      setViewing(data.campaign);

      // Fetch recipient preview sample
      const recRes = await api(`/campaigns/${campaign.id}/recipients`).catch(() => ({ sample: [] }));
      setRecipientSample(recRes.sample || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setSampleLoading(false);
    }
  }

  async function saveCampaign(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const tagList = form.targetTags
        .split(",")
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);

      const payload = {
        name: form.name.trim(),
        subject: form.subject.trim(),
        previewText: form.previewText.trim() || null,
        fromName: form.fromName.trim() || null,
        fromEmail: form.fromEmail.trim() || null,
        description: form.description.trim() || null,
        templateId: form.templateId || null,
        targetTags: tagList,
        html: form.html || undefined
      };

      if (editing) {
        await api(`/campaigns/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        setNotice("Campaign updated successfully.");
      } else {
        await api("/campaigns", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setNotice("Draft campaign created successfully.");
      }

      setModal("");
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCampaign(campaign) {
    if (campaign.status !== "DRAFT") {
      alert("Only draft campaigns can be deleted.");
      return;
    }

    if (!window.confirm(`Are you sure you want to delete draft campaign "${campaign.name}"?`)) {
      return;
    }

    try {
      await api(`/campaigns/${campaign.id}`, { method: "DELETE" });
      setNotice(`Campaign "${campaign.name}" deleted.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSendCampaign(c) {
    if (!writable) return;
    if (!window.confirm(`Are you sure you want to send "${c.name}" via Brevo now?`)) return;

    setSendBusy(true);
    setNotice(`Initiating background dispatch for "${c.name}"...`);
    setError("");

    try {
      const res = await api(`/campaigns/${c.id}/send`, { method: "POST" });
      setNotice(res.message);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSendBusy(false);
    }
  }

  async function handlePauseCampaign(c) {
    if (!writable) return;
    setSendBusy(true);
    setError("");
    try {
      const res = await api(`/campaigns/${c.id}/pause`, { method: "POST" });
      setNotice(res.message || `Campaign "${c.name}" paused.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSendBusy(false);
    }
  }

  async function handleResumeCampaign(c) {
    if (!writable) return;
    setSendBusy(true);
    setError("");
    try {
      const res = await api(`/campaigns/${c.id}/resume`, { method: "POST" });
      setNotice(res.message || `Campaign "${c.name}" resumed.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSendBusy(false);
    }
  }

  async function handleRetryFailedCampaign(c) {
    if (!writable) return;
    if (!window.confirm(`Retry sending to eligible failed recipients for "${c.name}"?`)) return;
    setSendBusy(true);
    setError("");
    try {
      const res = await api(`/campaigns/${c.id}/retry-failed`, { method: "POST" });
      setNotice(res.message || `Retrying ${res.resetCount || ""} failed recipient(s).`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSendBusy(false);
    }
  }

  async function openSchedule(campaign) {
    if (campaign.status !== "DRAFT") {
      setError("Only draft campaigns can be scheduled.");
      return;
    }
    setError("");
    setNotice("");
    setScheduling(campaign);
    setScheduleRecipientsCount(null);

    // Default to 1 hour ahead formatted for datetime-local
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const yr = future.getFullYear();
    const mo = String(future.getMonth() + 1).padStart(2, "0");
    const da = String(future.getDate()).padStart(2, "0");
    const hr = String(future.getHours()).padStart(2, "0");
    const mi = String(future.getMinutes()).padStart(2, "0");
    setScheduledDateTime(`${yr}-${mo}-${da}T${hr}:${mi}`);

    try {
      const data = await api(`/campaigns/${campaign.id}`);
      setScheduling(data.campaign);
      setScheduleRecipientsCount(data.campaign.eligibleRecipientsCount ?? 0);
    } catch (e) {
      setError(e.message);
    }
  }

  async function submitSchedule(e) {
    e.preventDefault();
    if (!scheduling || !scheduledDateTime) return;
    setScheduleBusy(true);
    setError("");

    try {
      const targetDate = new Date(scheduledDateTime);
      if (isNaN(targetDate.getTime()) || targetDate.getTime() <= Date.now()) {
        throw new Error("Scheduled time must be in the future.");
      }
      const res = await api(`/campaigns/${scheduling.id}/schedule`, {
        method: "POST",
        body: JSON.stringify({ scheduledAt: targetDate.toISOString() })
      });
      setNotice(res.message || "Campaign scheduled successfully.");
      setScheduling(null);
      if (modal === "view") setModal("");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setScheduleBusy(false);
    }
  }

  async function cancelSchedule(campaign) {
    if (campaign.status !== "SCHEDULED") {
      alert("Only scheduled campaigns can have their schedule cancelled.");
      return;
    }
    if (!window.confirm(`Cancel scheduled dispatch for "${campaign.name}"? It will return to DRAFT status.`)) {
      return;
    }
    try {
      const res = await api(`/campaigns/${campaign.id}/cancel-schedule`, { method: "POST" });
      setNotice(res.message || "Schedule cancelled.");
      if (modal === "view") setModal("");
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  function onTemplateChange(selectedId) {
    if (!selectedId) {
      setForm(prev => ({ ...prev, templateId: "" }));
      return;
    }

    const selected = templates.find(t => t.id === selectedId);
    if (!selected) return;

    if (form.html && form.html.trim() && form.templateId !== selectedId) {
      if (!window.confirm(`Load content from template "${selected.name}"? This will replace your current email body in this draft.`)) {
        return;
      }
    }

    setForm(prev => ({
      ...prev,
      templateId: selectedId,
      subject: prev.subject.trim() ? prev.subject : (selected.subject || ""),
      previewText: prev.previewText.trim() ? prev.previewText : (selected.previewText || ""),
      html: selected.html || prev.html
    }));
  }

  function addTagToForm(tag) {
    const current = form.targetTags
      .split(",")
      .map(t => t.trim())
      .filter(Boolean);
    if (!current.includes(tag)) {
      setForm(prev => ({ ...prev, targetTags: [...current, tag].join(", ") }));
    }
  }

  return (
    <div className="page-stack">
      {/* Title & Top Action Bar */}
      <div className="page-title-row">
        <div>
          <h1>Campaigns</h1>
          <p className="muted">
            {total.toLocaleString()} email campaigns · {role.toLowerCase()} access
          </p>
        </div>
        <div className="audience-actions">
          {writable && (
            <button className="primary-button" onClick={openCreate}>
              <Plus size={16} /> Create Campaign
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="audience-filters">
        <label className="search-box">
          <Search size={15} />
          <input
            placeholder="Search campaigns by name or subject"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </label>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SCHEDULED">Scheduled</option>
          <option value="QUEUED">Queued</option>
          <option value="SENDING">Sending</option>
          <option value="SENT">Sent</option>
          <option value="PAUSED">Paused</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      {notice && <p className="notice">{notice}</p>}
      {error && <p role="alert" className="error-box">{error}</p>}

      {/* Campaigns Table */}
      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Subject line</th>
                <th>Status</th>
                <th>Target Audience</th>
                <th>Recipients</th>
                <th>Created</th>
                <th>Scheduled</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "28px" }}>
                    Loading campaigns…
                  </td>
                </tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "28px" }}>
                    No campaigns found matching your filters.
                  </td>
                </tr>
              ) : (
                campaigns.map(c => (
                  <tr key={c.id}>
                    <td>
                      <div>
                        <b>{c.name}</b>
                        {c.description && <div className="muted" style={{ fontSize: "10px" }}>{c.description}</div>}
                      </div>
                    </td>
                    <td>
                      <div>
                        {c.subject}
                        {c.previewText && (
                          <div className="muted" style={{ fontSize: "10px" }}>
                            Preview: {c.previewText}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={statusClass(c.status)}>{c.status}</span>
                    </td>
                    <td>
                      {c.targetTags && c.targetTags.length > 0 ? (
                        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                          {c.targetTags.map(t => (
                            <span key={t} className="chip" style={{ padding: "3px 7px", fontSize: "10px" }}>
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">All Subscribers</span>
                      )}
                    </td>
                    <td>{c._count?.recipients ?? c.sendTotal ?? "—"}</td>
                    <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td>{c.scheduledAt ? new Date(c.scheduledAt).toLocaleString() : "—"}</td>
                    <td>
                      <div className="row-actions" style={{ minWidth: "160px" }}>
                        <button className="soft-button" onClick={() => openView(c)} title="View details">
                          <Eye size={13} /> View
                        </button>
                        <button
                          className="soft-button"
                          onClick={() => setOptimizingCampaign(c)}
                          title="AI Campaign Performance Optimizer"
                          style={{ color: "#6545bc", fontWeight: "600" }}
                        >
                          <Sparkles size={13} /> Optimize
                        </button>
                        {writable && (c.status === "DRAFT" || c.status === "SCHEDULED") && (
                          <button
                            className="soft-button"
                            onClick={() => handleSendCampaign(c)}
                            disabled={sendBusy}
                            title="Send campaign now via Brevo"
                            style={{ color: "#16a34a", fontWeight: "600" }}
                          >
                            <Send size={13} /> Send
                          </button>
                        )}
                        {writable && c.status === "SENDING" && (
                          <button
                            className="soft-button"
                            onClick={() => handlePauseCampaign(c)}
                            disabled={sendBusy}
                            title="Pause sending"
                            style={{ color: "#d97706", fontWeight: "600" }}
                          >
                            <Pause size={13} /> Pause
                          </button>
                        )}
                        {writable && c.status === "PAUSED" && (
                          <button
                            className="soft-button"
                            onClick={() => handleResumeCampaign(c)}
                            disabled={sendBusy}
                            title="Resume sending"
                            style={{ color: "#2563eb", fontWeight: "600" }}
                          >
                            <Play size={13} /> Resume
                          </button>
                        )}
                        {writable && (c.status === "SENT" || c.status === "FAILED") && c.sendFailed > 0 && (
                          <button
                            className="soft-button"
                            onClick={() => handleRetryFailedCampaign(c)}
                            disabled={sendBusy}
                            title="Retry sending to eligible failed recipients"
                            style={{ color: "#c34a4a" }}
                          >
                            <RefreshCw size={13} /> Retry
                          </button>
                        )}
                        {writable && c.status === "DRAFT" && (
                          <>
                            <button className="soft-button" onClick={() => openEdit(c)} title="Edit draft">
                              <Edit3 size={13} /> Edit
                            </button>
                            <button className="soft-button" onClick={() => openEditor(c)} title="Edit email content and preview">
                              <Palette size={13} /> Content
                            </button>
                            <button className="soft-button" onClick={() => openSchedule(c)} title="Schedule campaign">
                              <Calendar size={13} /> Schedule
                            </button>
                            <button
                              className="soft-button"
                              onClick={() => deleteCampaign(c)}
                              title="Delete draft"
                              style={{ color: "#c34a4a" }}
                            >
                              <Trash2 size={13} /> Delete
                            </button>
                          </>
                        )}
                        {writable && c.status === "SCHEDULED" && (
                          <button
                            className="soft-button"
                            onClick={() => cancelSchedule(c)}
                            title="Cancel scheduled dispatch"
                            style={{ color: "#c34a4a" }}
                          >
                            <X size={13} /> Cancel Schedule
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="pagination">
          <span>
            Page {page} of {pages} · {total} total
          </span>
          <div>
            <button
              className="soft-button"
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </button>{" "}
            <button
              className="soft-button"
              disabled={page >= pages || loading}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* CREATE / EDIT CAMPAIGN MODAL */}
      {modal === "edit" && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: "620px" }}>
            <div className="modal-head">
              <h2>{editing ? "Edit Draft Campaign" : "Create New Campaign"}</h2>
              <button className="icon-button" onClick={() => setModal("")}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={saveCampaign}>
              <div className="form-two">
                <label className="field-label">
                  Campaign Name *
                  <input
                    required
                    placeholder="e.g. Black Friday Launch"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label className="field-label">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Email Template</span>
                    {form.templateId && (
                      <button
                        type="button"
                        className="soft-button"
                        onClick={() => {
                          const t = templates.find(tmpl => tmpl.id === form.templateId);
                          if (t) setPreviewingTemplate(t);
                        }}
                        style={{ padding: "2px 7px", fontSize: "10px" }}
                        title="Preview selected template"
                      >
                        <Eye size={12} /> Preview Template
                      </button>
                    )}
                  </div>
                  <select
                    value={form.templateId}
                    onChange={e => onTemplateChange(e.target.value)}
                  >
                    <option value="">No template (use blank or custom HTML)</option>
                    {templates.map(tmpl => (
                      <option key={tmpl.id} value={tmpl.id}>
                        {tmpl.name} ({tmpl.category || "Custom"})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="field-label">
                Subject Line *
                <input
                  required
                  placeholder="e.g. Exclusive Early Access: 50% Off Everything"
                  value={form.subject}
                  onChange={e => setForm({ ...form, subject: e.target.value })}
                />
              </label>

              <label className="field-label">
                Preview Text
                <input
                  placeholder="Short preview snippet shown in inboxes"
                  value={form.previewText}
                  onChange={e => setForm({ ...form, previewText: e.target.value })}
                />
              </label>

              <div className="form-two">
                <label className="field-label">
                  Sender Name
                  <input
                    placeholder="e.g. Sarah from MailFlow"
                    value={form.fromName}
                    onChange={e => setForm({ ...form, fromName: e.target.value })}
                  />
                </label>
                <label className="field-label">
                  Sender Email
                  <input
                    type="email"
                    placeholder="e.g. marketing@example.com"
                    value={form.fromEmail}
                    onChange={e => setForm({ ...form, fromEmail: e.target.value })}
                  />
                </label>
              </div>

              <label className="field-label">
                Audience Filter Tags (comma separated)
                <input
                  placeholder="e.g. newsletter, vip, leads (leave empty for all subscribers)"
                  value={form.targetTags}
                  onChange={e => setForm({ ...form, targetTags: e.target.value })}
                />
              </label>

              {availableTags.length > 0 && (
                <div style={{ marginBottom: "14px" }}>
                  <small className="muted" style={{ display: "block", marginBottom: "6px" }}>
                    Click to add workspace tags:
                  </small>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {availableTags.map(tag => (
                      <button
                        type="button"
                        key={tag}
                        className="chip"
                        style={{ padding: "4px 8px", fontSize: "10px" }}
                        onClick={() => addTagToForm(tag)}
                      >
                        + {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label className="field-label">
                Internal Description
                <textarea
                  rows={2}
                  placeholder="Optional internal notes about campaign goals or targets"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                />
              </label>

              <div className="modal-actions">
                <button type="button" className="soft-button" onClick={() => setModal("")}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={busy}>
                  {busy ? "Saving…" : editing ? "Update Campaign" : "Create Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CAMPAIGN DETAILS VIEW MODAL */}
      {modal === "view" && viewing && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: "680px" }}>
            <div className="modal-head">
              <div>
                <h2>{viewing.name}</h2>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" }}>
                  <span className={statusClass(viewing.status)}>{viewing.status}</span>
                  <span className="muted" style={{ fontSize: "11px" }}>
                    Created: {new Date(viewing.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <button className="icon-button" onClick={() => setModal("")}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "12px" }}>
              {/* Campaign Metadata */}
              <div style={{ background: "#fafbfe", padding: "14px", borderRadius: "8px", border: "1px solid #f0f1f5" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <span className="muted" style={{ display: "block", fontSize: "10px" }}>SUBJECT</span>
                    <b>{viewing.subject}</b>
                  </div>
                  <div>
                    <span className="muted" style={{ display: "block", fontSize: "10px" }}>PREVIEW TEXT</span>
                    <span>{viewing.previewText || "—"}</span>
                  </div>
                  <div>
                    <span className="muted" style={{ display: "block", fontSize: "10px" }}>SENDER</span>
                    <span>
                      {viewing.fromName || "Workspace default"}
                      {viewing.fromEmail ? ` <${viewing.fromEmail}>` : ""}
                    </span>
                  </div>
                  <div>
                    <span className="muted" style={{ display: "block", fontSize: "10px" }}>TEMPLATE</span>
                    <span>{viewing.template?.name || "None"}</span>
                  </div>
                </div>
                {viewing.description && (
                  <div style={{ marginTop: "10px", borderTop: "1px solid #f0f1f5", paddingTop: "8px" }}>
                    <span className="muted" style={{ display: "block", fontSize: "10px" }}>DESCRIPTION</span>
                    <span>{viewing.description}</span>
                  </div>
                )}
              </div>

              {/* Audience Targeting & Eligible Recipient Count */}
              <div style={{ background: "#f8f5ff", padding: "14px", borderRadius: "8px", border: "1px solid #eee8ff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <span style={{ fontSize: "10px", color: "#6545bc", fontWeight: "700", display: "block" }}>
                      AUDIENCE TARGETING
                    </span>
                    <div style={{ marginTop: "4px" }}>
                      {viewing.targetTags && viewing.targetTags.length > 0 ? (
                        <span>Tags: {viewing.targetTags.join(", ")}</span>
                      ) : (
                        <span>All Subscribed Contacts</span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: "10px", color: "#6545bc", fontWeight: "700", display: "block" }}>
                      ELIGIBLE RECIPIENTS
                    </span>
                    <span style={{ fontSize: "18px", fontWeight: "800", color: "#6545bc" }}>
                      {viewing.eligibleRecipientsCount !== undefined
                        ? viewing.eligibleRecipientsCount.toLocaleString()
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Delivery Performance / Metrics */}
              {(viewing.sendTotal > 0 || viewing.status === "SENT" || viewing.status === "SENDING" || viewing.status === "FAILED") && (
                <div style={{ background: "#f0fdf4", padding: "14px", borderRadius: "8px", border: "1px solid #dcfce7" }}>
                  <span style={{ fontSize: "10px", color: "#166534", fontWeight: "700", display: "block" }}>
                    DELIVERY STATUS
                  </span>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginTop: "8px" }}>
                    <div>
                      <span className="muted" style={{ display: "block", fontSize: "10px" }}>TOTAL TARGET</span>
                      <b style={{ fontSize: "16px" }}>{viewing.sendTotal || viewing.eligibleRecipientsCount || 0}</b>
                    </div>
                    <div>
                      <span style={{ color: "#16a34a", display: "block", fontSize: "10px" }}>SENT</span>
                      <b style={{ fontSize: "16px", color: "#16a34a" }}>{viewing.sendSucceeded || 0}</b>
                    </div>
                    <div>
                      <span style={{ color: "#059669", display: "block", fontSize: "10px" }}>DELIVERED</span>
                      <b style={{ fontSize: "16px", color: "#059669" }}>{viewing.deliveredCount || 0}</b>
                    </div>
                    <div>
                      <span style={{ color: "#2563eb", display: "block", fontSize: "10px" }}>OPENED</span>
                      <b style={{ fontSize: "16px", color: "#2563eb" }}>{viewing.openedCount || 0}</b>
                    </div>
                    <div>
                      <span style={{ color: "#7c3aed", display: "block", fontSize: "10px" }}>CLICKED</span>
                      <b style={{ fontSize: "16px", color: "#7c3aed" }}>{viewing.clickedCount || 0}</b>
                    </div>
                    <div>
                      <span style={{ color: "#d97706", display: "block", fontSize: "10px" }}>BOUNCED</span>
                      <b style={{ fontSize: "16px", color: "#d97706" }}>{viewing.bouncedCount || 0}</b>
                    </div>
                    <div>
                      <span style={{ color: "#dc2626", display: "block", fontSize: "10px" }}>COMPLAINED</span>
                      <b style={{ fontSize: "16px", color: "#dc2626" }}>{viewing.complainedCount || 0}</b>
                    </div>
                    <div>
                      <span style={{ color: "#dc2626", display: "block", fontSize: "10px" }}>FAILED</span>
                      <b style={{ fontSize: "16px", color: "#dc2626" }}>{viewing.sendFailed || 0}</b>
                    </div>
                  </div>
                  {viewing.sendTotal > 0 && (
                    <div style={{ marginTop: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                        <span className="muted">
                          Dispatch Progress ({Math.round(((viewing.sendSucceeded || 0) / viewing.sendTotal) * 100)}%)
                        </span>
                        <span className="muted">
                          {viewing.pendingRecipientsCount !== undefined ? `${viewing.pendingRecipientsCount} pending` : ""}
                          {viewing.uncertainRecipientsCount > 0 ? ` · ${viewing.uncertainRecipientsCount} uncertain` : ""}
                        </span>
                      </div>
                      <div style={{ background: "#e5e7eb", borderRadius: "999px", height: "6px", overflow: "hidden" }}>
                        <div
                          style={{
                            background: viewing.status === "FAILED" ? "#dc2626" : (viewing.status === "PAUSED" ? "#d97706" : "#16a34a"),
                            height: "100%",
                            width: `${Math.min(100, Math.round(((viewing.sendSucceeded || 0) / viewing.sendTotal) * 100))}%`,
                            transition: "width 0.3s ease"
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {viewing.completedAt && (
                    <div style={{ marginTop: "8px", fontSize: "11px", color: "#166534" }}>
                      Completed at: {new Date(viewing.completedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              )}

              {/* Eligible Recipient Sample Preview */}
              <div>
                <h4 style={{ fontSize: "13px", marginBottom: "8px" }}>Eligible Recipient Sample</h4>
                {sampleLoading ? (
                  <p className="muted">Loading eligible recipients…</p>
                ) : recipientSample.length === 0 ? (
                  <p className="muted" style={{ fontSize: "11px" }}>
                    No subscribed contacts currently match this audience filter.
                  </p>
                ) : (
                  <div className="table-scroll" style={{ maxHeight: "180px", border: "1px solid #f0f1f5", borderRadius: "8px" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Name</th>
                          <th>Company</th>
                          <th>Tags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipientSample.map(r => (
                          <tr key={r.id}>
                            <td>{r.email}</td>
                            <td>{[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}</td>
                            <td>{r.company || "—"}</td>
                            <td>{(r.tags || []).join(", ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Email Content Preview */}
              {viewing.html && (
                <div>
                  <h4 style={{ fontSize: "13px", marginBottom: "8px" }}>Email Content Preview</h4>
                  <div
                    style={{
                      maxHeight: "220px",
                      overflow: "auto",
                      border: "1px solid #f0f1f5",
                      borderRadius: "8px",
                      padding: "12px",
                      background: "#fff"
                    }}
                    dangerouslySetInnerHTML={{ __html: viewing.html }}
                  />
                </div>
              )}
            </div>

            <div className="modal-actions">
              {writable && (viewing.status === "DRAFT" || viewing.status === "SCHEDULED") && (
                <button
                  className="primary-button"
                  style={{ background: "#16a34a" }}
                  onClick={() => {
                    const c = viewing;
                    setModal("");
                    handleSendCampaign(c);
                  }}
                  disabled={sendBusy}
                >
                  <Send size={13} /> Send Now
                </button>
              )}
              {writable && viewing.status === "SENDING" && (
                <button
                  className="soft-button"
                  style={{ color: "#d97706", fontWeight: "600" }}
                  onClick={() => {
                    const c = viewing;
                    setModal("");
                    handlePauseCampaign(c);
                  }}
                  disabled={sendBusy}
                >
                  <Pause size={13} /> Pause Sending
                </button>
              )}
              {writable && viewing.status === "PAUSED" && (
                <button
                  className="primary-button"
                  style={{ background: "#2563eb" }}
                  onClick={() => {
                    const c = viewing;
                    setModal("");
                    handleResumeCampaign(c);
                  }}
                  disabled={sendBusy}
                >
                  <Play size={13} /> Resume Sending
                </button>
              )}
              {writable && (viewing.status === "SENT" || viewing.status === "FAILED") && viewing.sendFailed > 0 && (
                <button
                  className="soft-button"
                  style={{ color: "#c34a4a" }}
                  onClick={() => {
                    const c = viewing;
                    setModal("");
                    handleRetryFailedCampaign(c);
                  }}
                  disabled={sendBusy}
                >
                  <RefreshCw size={13} /> Retry Failed
                </button>
              )}
              {writable && viewing.status === "DRAFT" && (
                <>
                  <button
                    className="soft-button"
                    onClick={() => {
                      const c = viewing;
                      setModal("");
                      openSchedule(c);
                    }}
                  >
                    <Calendar size={13} /> Schedule Dispatch
                  </button>
                  <button
                    className="soft-button"
                    onClick={() => {
                      setModal("");
                      openEditor(viewing);
                    }}
                  >
                    <Palette size={13} /> Open Email Editor
                  </button>
                  <button
                    className="soft-button"
                    onClick={() => {
                      setModal("");
                      openEdit(viewing);
                    }}
                  >
                    <Edit3 size={13} /> Edit Settings
                  </button>
                </>
              )}
              {writable && viewing.status === "SCHEDULED" && (
                <button
                  className="soft-button"
                  onClick={() => cancelSchedule(viewing)}
                  style={{ color: "#c34a4a" }}
                >
                  <X size={13} /> Cancel Schedule
                </button>
              )}
              <button
                type="button"
                className="soft-button"
                style={{ color: "#6545bc", fontWeight: "700" }}
                onClick={() => setOptimizingCampaign(viewing)}
              >
                <Sparkles size={13} /> AI Performance Optimizer
              </button>
              <button className="primary-button" onClick={() => setModal("")}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SCHEDULE CAMPAIGN MODAL */}
      {scheduling && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: "520px" }}>
            <div className="modal-head">
              <h2>Schedule Campaign Dispatch</h2>
              <button className="icon-button" onClick={() => setScheduling(null)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submitSchedule}>
              <div style={{ background: "#fafbfe", border: "1px solid #eceef4", borderRadius: "8px", padding: "14px", marginBottom: "16px", fontSize: "12px" }}>
                <div style={{ marginBottom: "6px" }}>
                  <span className="muted" style={{ fontSize: "10px" }}>CAMPAIGN</span>
                  <div style={{ fontWeight: "700" }}>{scheduling.name}</div>
                </div>
                <div style={{ marginBottom: "6px" }}>
                  <span className="muted" style={{ fontSize: "10px" }}>SUBJECT</span>
                  <div>{scheduling.subject || <span style={{ color: "#c34a4a" }}>⚠ Missing subject</span>}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <span className="muted" style={{ fontSize: "10px" }}>SENDER EMAIL</span>
                    <div>{scheduling.fromEmail || <span style={{ color: "#c34a4a" }}>⚠ Missing sender email</span>}</div>
                  </div>
                  <div>
                    <span className="muted" style={{ fontSize: "10px" }}>ESTIMATED AUDIENCE</span>
                    <div style={{ fontWeight: "700", color: "#6545bc" }}>
                      {scheduleRecipientsCount !== null
                        ? `${scheduleRecipientsCount.toLocaleString()} subscribers`
                        : "Checking…"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Readiness Checks Warning */}
              {(!scheduling.subject || !scheduling.html || !scheduling.fromEmail) && (
                <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", padding: "10px 14px", borderRadius: "8px", fontSize: "11px", marginBottom: "14px" }}>
                  <b>Pre-flight checklist warning:</b>
                  <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                    {!scheduling.subject && <li>Subject line is missing.</li>}
                    {!scheduling.html && <li>Email body content is empty.</li>}
                    {!scheduling.fromEmail && <li>Sender email address is required.</li>}
                  </ul>
                </div>
              )}

              {/* Date and Time Selector */}
              <label className="field-label">
                Scheduled Dispatch Date & Time *
                <input
                  type="datetime-local"
                  required
                  value={scheduledDateTime}
                  min={new Date().toISOString().slice(0, 16)}
                  onChange={e => setScheduledDateTime(e.target.value)}
                />
              </label>

              <div className="muted" style={{ fontSize: "11px", marginBottom: "16px" }}>
                Timezone: <b>{Intl.DateTimeFormat().resolvedOptions().timeZone}</b>
              </div>

              <div className="tip-box" style={{ marginBottom: "16px" }}>
                <Calendar size={16} />
                <span>
                  <b>Safe schedule management</b>
                  <small>
                    The campaign will be locked in SCHEDULED status. You can cancel the schedule at any time before delivery starts to return it to draft.
                  </small>
                </span>
              </div>

              <div className="modal-actions">
                <button type="button" className="soft-button" onClick={() => setScheduling(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={scheduleBusy || !scheduledDateTime}
                >
                  {scheduleBusy ? "Scheduling…" : "Confirm & Schedule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TEMPLATE QUICK PREVIEW MODAL */}
      {previewingTemplate && (
        <div className="modal-backdrop" style={{ zIndex: 120 }}>
          <div className="modal" style={{ width: "min(100%, 780px)", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 0 }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #eceef4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "15px" }}>Template: {previewingTemplate.name}</h3>
                <span className="muted" style={{ fontSize: "11px" }}>
                  Subject: <b>{previewingTemplate.subject || "No subject"}</b>
                </span>
              </div>
              <button className="icon-button" type="button" onClick={() => setPreviewingTemplate(null)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", background: "#f4f5f8", padding: "20px", display: "flex", justifyContent: "center" }}>
              <div
                style={{
                  width: "100%",
                  maxWidth: "600px",
                  background: "#fff",
                  borderRadius: "8px",
                  boxShadow: "0 2px 14px rgba(0,0,0,0.06)",
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
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULL EMAIL CONTENT EDITOR & PREVIEW */}
      {activeEditorCampaign && (
        <EmailEditor
          campaign={activeEditorCampaign}
          templates={templates}
          onSave={saveEditorContent}
          onClose={() => setActiveEditorCampaign(null)}
        />
      )}

      {/* AI CAMPAIGN PERFORMANCE OPTIMIZER MODAL */}
      {optimizingCampaign && (
        <CampaignOptimizerModal
          campaignId={optimizingCampaign.id}
          initialCampaign={optimizingCampaign}
          onClose={() => setOptimizingCampaign(null)}
          onCampaignUpdated={(updated, isDuplicated) => {
            refresh();
            if (isDuplicated) {
              setOptimizingCampaign(null);
            }
          }}
          writable={writable}
        />
      )}
    </div>
  );
}
