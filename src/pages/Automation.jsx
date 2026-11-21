import { useState, useEffect, useCallback } from "react";
import {
  Workflow,
  Plus,
  Play,
  Pause,
  Trash2,
  Edit3,
  Mail,
  Clock,
  Filter,
  Users,
  Search,
  CheckCircle2,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  X,
  Sparkles,
  Eye,
  RefreshCw,
  Send,
  GitBranch,
  ShieldAlert
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../state/AuthContext";

const blankWorkflow = {
  name: "",
  description: "",
  triggerType: "CONTACT_SUBSCRIBED",
  triggerConfig: { tag: "" },
  active: false,
  steps: [
    {
      type: "EMAIL",
      name: "Welcome Email",
      config: {
        subject: "Welcome to MailFlow! {{firstName}}",
        previewText: "We are thrilled to have you here.",
        html: "<p>Hello {{firstName}},</p><p>Welcome to our community! Here is what you can expect next...</p><p><a href='{{unsubscribe_url}}'>Unsubscribe</a></p>"
      }
    },
    {
      type: "DELAY",
      name: "Wait 2 Days",
      config: { amount: 2, unit: "days" }
    },
    {
      type: "EMAIL",
      name: "Getting Started Guide",
      config: {
        subject: "Quick tips to get the most out of your account",
        previewText: "3 simple steps to get started",
        html: "<p>Hello {{firstName}},</p><p>Check out our quick start guide below...</p><p><a href='{{unsubscribe_url}}'>Unsubscribe</a></p>"
      }
    }
  ]
};

export default function Automation() {
  const { user, workspace } = useAuth();
  const role = workspace?.role || user?.role || "VIEWER";
  const writable = ["OWNER", "ADMIN", "EDITOR"].includes(role);

  // Workflows listing state
  const [workflows, setWorkflows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Builder / Editor state
  const [editingWorkflow, setEditingWorkflow] = useState(null); // null = list view, object = builder mode
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [builderTab, setBuilderTab] = useState("builder"); // "builder" | "preview"

  // Enrollments Inspection Modal state
  const [viewingEnrollmentsWorkflow, setViewingEnrollmentsWorkflow] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(false);
  const [manualContactEmail, setManualContactEmail] = useState("");
  const [enrollingBusy, setEnrollingBusy] = useState(false);

  // Toast / feedback message
  const [toast, setToast] = useState(null);
  const showToast = msg => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // 1. Fetch workflows list
  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.append("q", search.trim());
      if (statusFilter !== "all") params.append("status", statusFilter);

      const res = await api(`/workflows?${params.toString()}`);
      setWorkflows(res.workflows || []);
      setTotal(res.total || 0);
    } catch (err) {
      console.error("Failed to load workflows:", err);
      setError(err?.message || "Failed to load automation workflows.");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  // 2. Toggle active/paused
  const handleToggleActive = async (wf, e) => {
    e?.stopPropagation();
    if (!writable) {
      showToast("Only Owners, Admins, and Editors can modify workflows.");
      return;
    }
    try {
      const res = await api(`/workflows/${wf.id}/toggle`, { method: "POST" });
      showToast(res.message);
      fetchWorkflows();
    } catch (err) {
      showToast(err?.message || "Failed to toggle workflow status.");
    }
  };

  // 3. Delete workflow
  const handleDelete = async (wf, e) => {
    e?.stopPropagation();
    if (!writable) return;
    if (!window.confirm(`Are you sure you want to delete workflow "${wf.name}"? All enrollments and steps will be removed.`)) {
      return;
    }
    try {
      await api(`/workflows/${wf.id}`, { method: "DELETE" });
      showToast(`Workflow "${wf.name}" deleted.`);
      fetchWorkflows();
    } catch (err) {
      showToast(err?.message || "Failed to delete workflow.");
    }
  };

  // 4. Open builder
  const openCreateBuilder = () => {
    if (!writable) return;
    setEditingWorkflow({ ...blankWorkflow });
    setIsNew(true);
    setBuilderTab("builder");
  };

  const openEditBuilder = async wf => {
    try {
      const res = await api(`/workflows/${wf.id}`);
      setEditingWorkflow(res.workflow);
      setIsNew(false);
      setBuilderTab("builder");
    } catch (err) {
      showToast(err?.message || "Failed to load workflow details.");
    }
  };

  // 5. Save workflow in builder
  const handleSaveWorkflow = async activateNow => {
    if (!editingWorkflow.name?.trim()) {
      showToast("Please enter a workflow name.");
      return;
    }
    if ((editingWorkflow.steps || []).length === 0) {
      showToast("Workflow must have at least one step.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: editingWorkflow.name.trim(),
        description: editingWorkflow.description?.trim() || null,
        triggerType: editingWorkflow.triggerType,
        triggerConfig: editingWorkflow.triggerConfig || {},
        active: activateNow !== undefined ? activateNow : editingWorkflow.active,
        steps: (editingWorkflow.steps || []).map((s, index) => ({
          type: s.type,
          name: s.name?.trim() || `${s.type} Step ${index + 1}`,
          config: s.config || {}
        }))
      };

      if (isNew) {
        await api("/workflows", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        showToast("Workflow created successfully!");
      } else {
        await api(`/workflows/${editingWorkflow.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        showToast("Workflow updated successfully!");
      }

      setEditingWorkflow(null);
      fetchWorkflows();
    } catch (err) {
      showToast(err?.message || "Failed to save workflow.");
    } finally {
      setSaving(false);
    }
  };

  // Builder step operations
  const handleAddStep = type => {
    let newStep = {
      type,
      name: type === "EMAIL" ? "New Email" : type === "DELAY" ? "Wait Delay" : "Condition Check",
      config:
        type === "EMAIL"
          ? { subject: "Update for you", previewText: "Check this out", html: "<p>Hello {{firstName}},</p><p><a href='{{unsubscribe_url}}'>Unsubscribe</a></p>" }
          : type === "DELAY"
          ? { amount: 1, unit: "days" }
          : { field: "tags", operator: "contains", value: "vip", onFail: "STOP" }
    };
    setEditingWorkflow(prev => ({
      ...prev,
      steps: [...(prev.steps || []), newStep]
    }));
  };

  const handleRemoveStep = index => {
    setEditingWorkflow(prev => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index)
    }));
  };

  const handleMoveStep = (index, direction) => {
    const steps = [...(editingWorkflow.steps || [])];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= steps.length) return;
    const temp = steps[index];
    steps[index] = steps[targetIndex];
    steps[targetIndex] = temp;
    setEditingWorkflow(prev => ({ ...prev, steps }));
  };

  const handleUpdateStepConfig = (index, newConfig) => {
    const steps = [...(editingWorkflow.steps || [])];
    steps[index] = {
      ...steps[index],
      config: { ...steps[index].config, ...newConfig }
    };
    setEditingWorkflow(prev => ({ ...prev, steps }));
  };

  const handleUpdateStepName = (index, name) => {
    const steps = [...(editingWorkflow.steps || [])];
    steps[index] = { ...steps[index], name };
    setEditingWorkflow(prev => ({ ...prev, steps }));
  };

  // 6. Enrollments Inspection Modal
  const openEnrollmentsModal = async wf => {
    setViewingEnrollmentsWorkflow(wf);
    setEnrollmentsLoading(true);
    try {
      const res = await api(`/workflows/${wf.id}/enrollments?limit=50`);
      setEnrollments(res.enrollments || []);
    } catch (err) {
      showToast(err?.message || "Failed to load enrollments.");
    } finally {
      setEnrollmentsLoading(false);
    }
  };

  const handleManualEnroll = async () => {
    if (!manualContactEmail.trim()) {
      showToast("Please enter an email address.");
      return;
    }
    setEnrollingBusy(true);
    try {
      // Find contact by email in workspace
      const searchRes = await api(`/contacts?q=${encodeURIComponent(manualContactEmail.trim())}`);
      const matched = searchRes.contacts?.find(
        c => c.email.toLowerCase() === manualContactEmail.trim().toLowerCase()
      );

      if (!matched) {
        showToast("Contact not found in this workspace. Add the contact first in Audience.");
        setEnrollingBusy(false);
        return;
      }

      const enrollRes = await api(`/workflows/${viewingEnrollmentsWorkflow.id}/enroll`, {
        method: "POST",
        body: JSON.stringify({ contactId: matched.id })
      });

      showToast(enrollRes.message);
      setManualContactEmail("");
      // Refresh enrollments
      const updated = await api(`/workflows/${viewingEnrollmentsWorkflow.id}/enrollments?limit=50`);
      setEnrollments(updated.enrollments || []);
    } catch (err) {
      showToast(err?.message || "Failed to enroll contact.");
    } finally {
      setEnrollingBusy(false);
    }
  };

  // Aggregation stats
  const totalActive = workflows.filter(w => w.active).length;
  const totalEnrolled = workflows.reduce((acc, w) => acc + (w.enrollmentsCount || 0), 0);
  const totalCompleted = workflows.reduce((acc, w) => acc + (w.completedEnrollments || 0), 0);

  return (
    <div className="page-content">
      {/* TOAST FEEDBACK */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            zIndex: 100,
            background: "#20243a",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 8,
            fontSize: 12,
            boxShadow: "0 6px 20px rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "center",
            gap: 10
          }}
        >
          <span>{toast}</span>
          <button onClick={() => setToast(null)} style={{ background: "none", border: 0, color: "#fff" }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* VIEW 1: WORKFLOWS LIST VIEW */}
      {!editingWorkflow && (
        <div className="page-stack">
          {/* HEADER */}
          <div className="page-title-row">
            <div>
              <div className="eyebrow">AUTOMATION & DRIP SEQUENCES</div>
              <h1>Automation Workflows</h1>
              <p className="muted">
                Trigger-based onboarding sequences, nurture drips, and conditional event flows that run automatically in the background.
              </p>
            </div>

            {writable && (
              <button className="primary-button" onClick={openCreateBuilder}>
                <Plus size={16} /> Create Workflow
              </button>
            )}
          </div>

          {/* STATS OVERVIEW CARDS */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-top">
                <span>TOTAL WORKFLOWS</span>
                <span className="stat-icon purple"><Workflow size={16} /></span>
              </div>
              <div className="stat-value">{workflows.length}</div>
              <div className="stat-change">{totalActive} currently active</div>
            </div>

            <div className="stat-card">
              <div className="stat-top">
                <span>ACTIVE SEQUENCES</span>
                <span className="stat-icon green"><Play size={16} /></span>
              </div>
              <div className="stat-value">{totalActive}</div>
              <div className="stat-change">Listening for contact events</div>
            </div>

            <div className="stat-card">
              <div className="stat-top">
                <span>CONTACTS ENROLLED</span>
                <span className="stat-icon blue"><Users size={16} /></span>
              </div>
              <div className="stat-value">{totalEnrolled.toLocaleString()}</div>
              <div className="stat-change">Across all sequences</div>
            </div>

            <div className="stat-card">
              <div className="stat-top">
                <span>COMPLETED DRIPS</span>
                <span className="stat-icon orange"><CheckCircle2 size={16} /></span>
              </div>
              <div className="stat-value">{totalCompleted.toLocaleString()}</div>
              <div className="stat-change">Fully finished sequences</div>
            </div>
          </div>

          {/* SEARCH & FILTERS TOOLBAR */}
          <div className="panel table-panel">
            <div className="panel-heading" style={{ padding: "0 20px 16px", borderBottom: "1px solid #f0f1f5" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", width: "100%", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="search-box">
                    <Search size={14} />
                    <input
                      placeholder="Search workflows…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    className="analytics-sort-select"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active Only</option>
                    <option value="paused">Paused / Draft</option>
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8b91a3" }}>
                  <span>Showing {workflows.length} of {total}</span>
                  <button className="soft-button" onClick={fetchWorkflows} style={{ padding: "4px 8px" }} title="Refresh">
                    <RefreshCw size={12} className={loading ? "spin" : ""} />
                  </button>
                </div>
              </div>
            </div>

            {/* WORKFLOW TABLE */}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>Trigger</th>
                    <th>Steps</th>
                    <th>Status</th>
                    <th>Enrolled / Active</th>
                    <th>Completed</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && workflows.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", padding: "40px", color: "#8b91a3" }}>
                        Loading automation workflows…
                      </td>
                    </tr>
                  ) : workflows.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", padding: "40px", color: "#8b91a3" }}>
                        No workflows found.{" "}
                        {writable && (
                          <button
                            onClick={openCreateBuilder}
                            style={{ background: "none", border: 0, color: "#6545bc", fontWeight: 700, cursor: "pointer" }}
                          >
                            Create your first workflow →
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    workflows.map(wf => (
                      <tr key={wf.id}>
                        <td>
                          <div style={{ fontWeight: 700, color: "#20243a", fontSize: 13 }}>
                            {wf.name}
                          </div>
                          {wf.description && (
                            <div style={{ fontSize: 11, color: "#8b91a3", maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {wf.description}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="step-type-badge step-badge-trigger">
                            {wf.triggerType === "CONTACT_SUBSCRIBED" ? "⚡ Subscribed" : `⚡ Tag: ${wf.triggerConfig?.tag || "Any"}`}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600, color: "#475569" }}>
                            {wf.stepsCount} {wf.stepsCount === 1 ? "step" : "steps"}
                          </span>
                        </td>
                        <td>
                          <span className={`status ${wf.active ? "good" : "draft"}`}>
                            {wf.active ? "ACTIVE" : "PAUSED"}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, color: "#20243a" }}>
                            {wf.activeEnrollments || 0}
                          </span>
                          <span className="muted" style={{ fontSize: 10 }}> / {wf.enrollmentsCount || 0} total</span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600, color: "#16a34a" }}>
                            {wf.completedEnrollments || 0}
                          </span>
                        </td>
                        <td>
                          <span className="muted">
                            {new Date(wf.createdAt).toLocaleDateString()}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <button
                              type="button"
                              className="soft-button"
                              onClick={() => openEditBuilder(wf)}
                              style={{ padding: "4px 8px", fontSize: 11 }}
                              title="Open workflow sequence builder"
                            >
                              <Edit3 size={12} /> {writable ? "Edit" : "View"}
                            </button>

                            <button
                              type="button"
                              className="soft-button"
                              onClick={() => openEnrollmentsModal(wf)}
                              style={{ padding: "4px 8px", fontSize: 11, color: "#3b82f6" }}
                              title="View enrolled contacts and execution progress"
                            >
                              <Users size={12} /> Enrollments
                            </button>

                            {writable && (
                              <button
                                type="button"
                                className="soft-button"
                                onClick={e => handleToggleActive(wf, e)}
                                style={{
                                  padding: "4px 8px",
                                  fontSize: 11,
                                  color: wf.active ? "#d97706" : "#16a34a",
                                  fontWeight: 600
                                }}
                                title={wf.active ? "Pause workflow" : "Activate workflow"}
                              >
                                {wf.active ? <Pause size={12} /> : <Play size={12} />}
                                {wf.active ? "Pause" : "Activate"}
                              </button>
                            )}

                            {writable && (
                              <button
                                type="button"
                                className="soft-button"
                                onClick={e => handleDelete(wf, e)}
                                style={{ padding: "4px 8px", fontSize: 11, color: "#dc2626" }}
                                title="Delete workflow"
                              >
                                <Trash2 size={12} />
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
          </div>
        </div>
      )}

      {/* VIEW 2: WORKFLOW BUILDER / EDITOR MODE */}
      {editingWorkflow && (
        <div className="page-stack">
          {/* BUILDER HEADER */}
          <div className="workflow-builder-header">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                type="button"
                className="soft-button"
                onClick={() => setEditingWorkflow(null)}
                style={{ padding: "6px 10px" }}
              >
                ← Back to Workflows
              </button>
              <div>
                <h2 style={{ fontSize: 18, margin: 0 }}>
                  {isNew ? "Create Automation Sequence" : `Edit Workflow: ${editingWorkflow.name}`}
                </h2>
                <span className="muted" style={{ fontSize: 11 }}>
                  Define triggers, automated emails, delays, and branch conditions
                </span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Tab Selector */}
              <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 8, padding: 2 }}>
                <button
                  type="button"
                  onClick={() => setBuilderTab("builder")}
                  style={{
                    padding: "6px 12px",
                    border: 0,
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    background: builderTab === "builder" ? "#fff" : "transparent",
                    color: builderTab === "builder" ? "#6545bc" : "#64748b"
                  }}
                >
                  <Workflow size={12} style={{ marginRight: 4 }} /> Sequence Builder
                </button>
                <button
                  type="button"
                  onClick={() => setBuilderTab("preview")}
                  style={{
                    padding: "6px 12px",
                    border: 0,
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    background: builderTab === "preview" ? "#fff" : "transparent",
                    color: builderTab === "preview" ? "#6545bc" : "#64748b"
                  }}
                >
                  <Eye size={12} style={{ marginRight: 4 }} /> Timeline Preview
                </button>
              </div>

              {writable && (
                <>
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => handleSaveWorkflow(false)}
                    disabled={saving}
                  >
                    Save as Draft
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => handleSaveWorkflow(true)}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save & Activate"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* BUILDER BODY */}
          {builderTab === "builder" ? (
            <div className="workflow-pipeline">
              {/* 1. METADATA & TRIGGER NODE */}
              <div className="workflow-node trigger-node">
                <div className="step-header-row">
                  <span className="step-type-badge step-badge-trigger">
                    ⚡ Workflow Trigger
                  </span>
                  <span className="muted" style={{ fontSize: 10 }}>Starts the sequence</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <label className="field-label" style={{ margin: 0 }}>
                    Workflow Name *
                    <input
                      value={editingWorkflow.name}
                      onChange={e => setEditingWorkflow({ ...editingWorkflow, name: e.target.value })}
                      placeholder="e.g. 5-Day Welcome Onboarding Drip"
                      disabled={!writable}
                    />
                  </label>
                  <label className="field-label" style={{ margin: 0 }}>
                    Enrollment Trigger Event *
                    <select
                      value={editingWorkflow.triggerType}
                      onChange={e => setEditingWorkflow({ ...editingWorkflow, triggerType: e.target.value })}
                      disabled={!writable}
                    >
                      <option value="CONTACT_SUBSCRIBED">When a contact subscribes</option>
                      <option value="TAG_ADDED">When a specific tag is added</option>
                    </select>
                  </label>
                </div>

                {editingWorkflow.triggerType === "TAG_ADDED" && (
                  <label className="field-label" style={{ marginBottom: 12 }}>
                    Trigger Tag (lowercase)
                    <input
                      value={editingWorkflow.triggerConfig?.tag || ""}
                      onChange={e =>
                        setEditingWorkflow({
                          ...editingWorkflow,
                          triggerConfig: { ...editingWorkflow.triggerConfig, tag: e.target.value.toLowerCase().trim() }
                        })
                      }
                      placeholder="e.g. lead, webinar, vip"
                      disabled={!writable}
                    />
                  </label>
                )}

                <label className="field-label" style={{ margin: 0 }}>
                  Internal Description
                  <input
                    value={editingWorkflow.description || ""}
                    onChange={e => setEditingWorkflow({ ...editingWorkflow, description: e.target.value })}
                    placeholder="Optional notes regarding the purpose of this sequence"
                    disabled={!writable}
                  />
                </label>
              </div>

              {/* 2. SEQUENCE STEPS */}
              {(editingWorkflow.steps || []).map((step, idx) => (
                <div key={idx} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div className="workflow-connector">
                    <div className="workflow-connector-line" />
                    <ArrowDown size={14} />
                  </div>

                  <div
                    className={`workflow-node ${
                      step.type === "EMAIL"
                        ? "email-node"
                        : step.type === "DELAY"
                        ? "delay-node"
                        : "condition-node"
                    }`}
                  >
                    <div className="step-header-row">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          className={`step-type-badge ${
                            step.type === "EMAIL"
                              ? "step-badge-email"
                              : step.type === "DELAY"
                              ? "step-badge-delay"
                              : "step-badge-condition"
                          }`}
                        >
                          Step {idx + 1}: {step.type}
                        </span>
                        <input
                          style={{
                            border: 0,
                            fontWeight: 700,
                            fontSize: 13,
                            color: "#1e293b",
                            background: "transparent",
                            outline: "none"
                          }}
                          value={step.name || ""}
                          onChange={e => handleUpdateStepName(idx, e.target.value)}
                          placeholder="Step Name"
                          disabled={!writable}
                        />
                      </div>

                      {writable && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => handleMoveStep(idx, -1)}
                            disabled={idx === 0}
                            title="Move Up"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => handleMoveStep(idx, 1)}
                            disabled={idx === editingWorkflow.steps.length - 1}
                            title="Move Down"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => handleRemoveStep(idx)}
                            style={{ color: "#dc2626" }}
                            title="Delete Step"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* STEP 1: EMAIL STEP FORM */}
                    {step.type === "EMAIL" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <label className="field-label" style={{ margin: 0 }}>
                          Subject Line *
                          <input
                            value={step.config?.subject || ""}
                            onChange={e => handleUpdateStepConfig(idx, { subject: e.target.value })}
                            placeholder="e.g. Welcome to our community, {{firstName}}!"
                            disabled={!writable}
                          />
                        </label>

                        <label className="field-label" style={{ margin: 0 }}>
                          Preview Text (Preheader snippet)
                          <input
                            value={step.config?.previewText || ""}
                            onChange={e => handleUpdateStepConfig(idx, { previewText: e.target.value })}
                            placeholder="Snippet shown in inboxes next to subject line"
                            disabled={!writable}
                          />
                        </label>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <label className="field-label" style={{ margin: 0 }}>
                            Sender Name
                            <input
                              value={step.config?.fromName || ""}
                              onChange={e => handleUpdateStepConfig(idx, { fromName: e.target.value })}
                              placeholder="e.g. Sarah from MailFlow"
                              disabled={!writable}
                            />
                          </label>
                          <label className="field-label" style={{ margin: 0 }}>
                            Sender Email
                            <input
                              type="email"
                              value={step.config?.fromEmail || ""}
                              onChange={e => handleUpdateStepConfig(idx, { fromEmail: e.target.value })}
                              placeholder="e.g. updates@mailflow.ai"
                              disabled={!writable}
                            />
                          </label>
                        </div>

                        <label className="field-label" style={{ margin: 0 }}>
                          Email Body HTML *
                          <textarea
                            rows={4}
                            value={step.config?.html || ""}
                            onChange={e => handleUpdateStepConfig(idx, { html: e.target.value })}
                            placeholder="<p>Hello {{firstName}},</p><p>Welcome to our platform!</p><p><a href='{{unsubscribe_url}}'>Unsubscribe</a></p>"
                            disabled={!writable}
                            style={{ fontFamily: "monospace", fontSize: 11 }}
                          />
                        </label>
                      </div>
                    )}

                    {/* STEP 2: DELAY STEP FORM */}
                    {step.type === "DELAY" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <label className="field-label" style={{ margin: 0 }}>
                          Wait Duration *
                          <input
                            type="number"
                            min="1"
                            value={step.config?.amount ?? step.config?.delayMinutes ?? 1}
                            onChange={e => handleUpdateStepConfig(idx, { amount: parseInt(e.target.value, 10) || 1 })}
                            disabled={!writable}
                          />
                        </label>
                        <label className="field-label" style={{ margin: 0 }}>
                          Time Unit *
                          <select
                            value={step.config?.unit || "days"}
                            onChange={e => handleUpdateStepConfig(idx, { unit: e.target.value })}
                            disabled={!writable}
                          >
                            <option value="minutes">Minutes</option>
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                          </select>
                        </label>
                      </div>
                    )}

                    {/* STEP 3: CONDITION STEP FORM */}
                    {step.type === "CONDITION" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                          <label className="field-label" style={{ margin: 0 }}>
                            Check Field
                            <select
                              value={step.config?.field || "tags"}
                              onChange={e => handleUpdateStepConfig(idx, { field: e.target.value })}
                              disabled={!writable}
                            >
                              <option value="tags">Contact Tags</option>
                              <option value="company">Company</option>
                            </select>
                          </label>
                          <label className="field-label" style={{ margin: 0 }}>
                            Condition Rule
                            <select
                              value={step.config?.operator || "contains"}
                              onChange={e => handleUpdateStepConfig(idx, { operator: e.target.value })}
                              disabled={!writable}
                            >
                              <option value="contains">Contains</option>
                              <option value="not_contains">Does Not Contain</option>
                              <option value="equals">Equals</option>
                              <option value="is_not_empty">Is Not Empty</option>
                            </select>
                          </label>
                          <label className="field-label" style={{ margin: 0 }}>
                            Target Value
                            <input
                              value={step.config?.value || ""}
                              onChange={e => handleUpdateStepConfig(idx, { value: e.target.value })}
                              placeholder="e.g. vip or leads"
                              disabled={!writable}
                            />
                          </label>
                        </div>
                        <label className="field-label" style={{ margin: 0 }}>
                          If Condition Not Met
                          <select
                            value={step.config?.onFail || "STOP"}
                            onChange={e => handleUpdateStepConfig(idx, { onFail: e.target.value })}
                            disabled={!writable}
                          >
                            <option value="STOP">Stop & Complete Workflow for Contact</option>
                            <option value="CONTINUE">Skip and Continue to Next Step</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* 3. ADD STEP ACTION BAR */}
              {writable && (
                <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div className="workflow-connector">
                    <div className="workflow-connector-line" />
                    <ArrowDown size={14} />
                  </div>

                  <div className="add-step-bar" style={{ width: "100%", maxWidth: 620, justifyContent: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginRight: 8 }}>
                      + Add Next Action:
                    </span>
                    <button
                      type="button"
                      className="soft-button"
                      onClick={() => handleAddStep("EMAIL")}
                      style={{ color: "#2563eb", fontWeight: 700 }}
                    >
                      <Mail size={13} /> Send Email
                    </button>
                    <button
                      type="button"
                      className="soft-button"
                      onClick={() => handleAddStep("DELAY")}
                      style={{ color: "#d97706", fontWeight: 700 }}
                    >
                      <Clock size={13} /> Wait / Delay
                    </button>
                    <button
                      type="button"
                      className="soft-button"
                      onClick={() => handleAddStep("CONDITION")}
                      style={{ color: "#059669", fontWeight: 700 }}
                    >
                      <GitBranch size={13} /> Condition Branch
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* PREVIEW / SIMULATION TIMELINE TAB */
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "0 0 12px 12px", padding: 24 }}>
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>Sequence Progression Timeline</h3>
              <p className="muted" style={{ fontSize: 12, marginBottom: 18 }}>
                Simulated execution timeline for a newly enrolled contact starting at Day 0:
              </p>

              <div className="workflow-preview-timeline">
                <div className="timeline-item">
                  <div className="timeline-dot" style={{ background: "#7e22ce" }} />
                  <div>
                    <span style={{ fontWeight: 700, color: "#7e22ce" }}>Trigger Event Occurs</span>
                    <p style={{ margin: "2px 0 0", color: "#64748b" }}>
                      Contact is enrolled via {editingWorkflow.triggerType === "CONTACT_SUBSCRIBED" ? "subscription event" : `tag [${editingWorkflow.triggerConfig?.tag || "any"}]`}.
                    </p>
                  </div>
                </div>

                {(editingWorkflow.steps || []).map((step, idx) => (
                  <div key={idx} className="timeline-item">
                    <div
                      className="timeline-dot"
                      style={{
                        background: step.type === "EMAIL" ? "#2563eb" : step.type === "DELAY" ? "#d97706" : "#059669"
                      }}
                    />
                    <div>
                      <span style={{ fontWeight: 700, color: "#0f172a" }}>
                        Step {idx + 1}: {step.name || step.type}
                      </span>
                      {step.type === "EMAIL" && (
                        <p style={{ margin: "2px 0 0", color: "#64748b" }}>
                          Sends email with subject: "<i>{step.config?.subject || "(No subject)"}</i>"
                        </p>
                      )}
                      {step.type === "DELAY" && (
                        <p style={{ margin: "2px 0 0", color: "#64748b" }}>
                          Pauses sequence for {step.config?.amount || 1} {step.config?.unit || "days"}
                        </p>
                      )}
                      {step.type === "CONDITION" && (
                        <p style={{ margin: "2px 0 0", color: "#64748b" }}>
                          Verifies if {step.config?.field || "tags"} {step.config?.operator || "contains"} "{step.config?.value || ""}" (If false: {step.config?.onFail || "STOP"})
                        </p>
                      )}
                    </div>
                  </div>
                ))}

                <div className="timeline-item">
                  <div className="timeline-dot" style={{ background: "#16a34a" }} />
                  <div>
                    <span style={{ fontWeight: 700, color: "#16a34a" }}>Workflow Completed</span>
                    <p style={{ margin: "2px 0 0", color: "#64748b" }}>
                      Enrollment marked completed. No further actions taken.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: ENROLLMENTS INSPECTION MODAL */}
      {viewingEnrollmentsWorkflow && (
        <div className="modal-backdrop">
          <div className="modal" style={{ width: "min(100%, 780px)", maxHeight: "90vh" }}>
            <div className="modal-head">
              <div>
                <h2>{viewingEnrollmentsWorkflow.name} — Enrollments</h2>
                <span className="muted" style={{ fontSize: 11 }}>
                  Contact enrollment status, execution progress, and manual triggers
                </span>
              </div>
              <button className="icon-button" onClick={() => setViewingEnrollmentsWorkflow(null)}>
                <X size={18} />
              </button>
            </div>

            {/* MANUAL ENROLLMENT TOOLBAR */}
            {writable && (
              <div style={{ background: "#f8fafc", padding: "12px 16px", borderRadius: 10, border: "1px solid #e2e8f0", marginBottom: 16 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>
                  + Manually Enroll Contact:
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="email"
                    placeholder="Enter contact email already in workspace…"
                    value={manualContactEmail}
                    onChange={e => setManualContactEmail(e.target.value)}
                    style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 12 }}
                  />
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleManualEnroll}
                    disabled={enrollingBusy}
                    style={{ padding: "8px 16px" }}
                  >
                    {enrollingBusy ? "Enrolling…" : "Enroll"}
                  </button>
                </div>
              </div>
            )}

            {/* ENROLLMENTS TABLE */}
            <div className="table-scroll" style={{ maxHeight: "360px", border: "1px solid #f0f1f5", borderRadius: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Enrolled At</th>
                    <th>Next Execution</th>
                    <th>Error / Note</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollmentsLoading ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "30px", color: "#8b91a3" }}>
                        Loading enrolled contacts…
                      </td>
                    </tr>
                  ) : enrollments.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "30px", color: "#8b91a3" }}>
                        No contacts have been enrolled in this workflow yet.
                      </td>
                    </tr>
                  ) : (
                    enrollments.map(en => (
                      <tr key={en.id}>
                        <td>
                          <div style={{ fontWeight: 700, color: "#20243a" }}>
                            {en.contact?.email}
                          </div>
                          <div style={{ fontSize: 10, color: "#8b91a3" }}>
                            {[en.contact?.firstName, en.contact?.lastName].filter(Boolean).join(" ") || "—"}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`status ${
                              en.status === "COMPLETED" ? "good" : en.status === "ACTIVE" ? "draft" : "muted-status"
                            }`}
                          >
                            {en.status}
                          </span>
                        </td>
                        <td>
                          <span className="muted">
                            {new Date(en.enrolledAt).toLocaleDateString()}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 11, color: "#475569" }}>
                            {en.status === "ACTIVE"
                              ? new Date(en.nextExecutionAt).toLocaleString()
                              : en.completedAt
                              ? `Finished: ${new Date(en.completedAt).toLocaleDateString()}`
                              : "—"}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 10, color: en.error ? "#dc2626" : "#8b91a3" }}>
                            {en.error || "—"}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="soft-button"
                onClick={() => setViewingEnrollmentsWorkflow(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
