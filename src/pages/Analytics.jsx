import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  TrendingUp,
  Mail,
  Send,
  CheckCircle2,
  Eye,
  MousePointerClick,
  AlertTriangle,
  Users,
  RefreshCw,
  Calendar,
  Info,
  ArrowUpRight,
  ShieldAlert,
  BarChart3,
  XCircle,
  Sparkles
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend
} from "recharts";
import StatCard from "../components/StatCard";
import { api } from "../lib/api";
import { useAuth } from "../state/AuthContext";
import CampaignOptimizerModal from "../components/CampaignOptimizerModal";

export default function Analytics() {
  const { user, workspace } = useAuth();
  const role = workspace?.role || user?.role || "VIEWER";
  const writable = ["OWNER", "ADMIN", "EDITOR"].includes(role);

  const [range, setRange] = useState("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCampaign, setSelectedCampaign] = useState(null);

  const [data, setData] = useState({
    summary: {
      totalCampaigns: 0,
      sentCampaigns: 0,
      targetedRecipients: 0,
      submitted: 0,
      delivered: 0,
      failed: 0,
      bounced: 0,
      opened: 0,
      clicked: 0,
      complained: 0,
      deliveryRate: 0,
      openRate: 0,
      clickRate: 0,
      bounceRate: 0,
      statusBreakdown: {}
    },
    timeseries: [],
    topCampaigns: [],
    recentActivity: [],
    failures: {
      breakdown: { failed: 0, bounced: 0, complained: 0, totalIssues: 0 },
      recentFailures: []
    },
    trackingNotice: ""
  });

  const [topSortBy, setTopSortBy] = useState("openRate");

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = `?range=${range}`;
      if (range === "custom") {
        if (!customStart || !customEnd) {
          setError("Please select both start and end dates for custom range.");
          setLoading(false);
          return;
        }
        query += `&from=${customStart}&to=${customEnd}`;
      }

      // Fetch overview, failures, and recent activity
      const [mainRes, failuresRes, activityRes] = await Promise.all([
        api(`/analytics${query}`),
        api(`/analytics/failures${query}`).catch(() => ({ breakdown: { failed: 0, bounced: 0, complained: 0, totalIssues: 0 }, recentFailures: [] })),
        api(`/analytics/recent-activity?limit=5`).catch(() => ({ activity: [] }))
      ]);

      setData({
        summary: mainRes.summary || {},
        timeseries: mainRes.timeseries || [],
        topCampaigns: mainRes.topCampaigns || [],
        recentActivity: activityRes.activity || [],
        failures: failuresRes || { breakdown: { failed: 0, bounced: 0, complained: 0, totalIssues: 0 }, recentFailures: [] },
        trackingNotice: mainRes.trackingNotice || ""
      });
    } catch (err) {
      console.error("Failed to load analytics", err);
      setError(err.message || "Failed to load analytics data.");
    } finally {
      setLoading(false);
    }
  }, [range, customStart, customEnd]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const handleRangeChange = (newRange) => {
    setRange(newRange);
    if (newRange === "custom") {
      setShowCustomPicker(true);
    } else {
      setShowCustomPicker(false);
    }
  };

  const handleApplyCustomRange = (e) => {
    e.preventDefault();
    if (!customStart || !customEnd) {
      setError("Please select both a start and end date.");
      return;
    }
    if (new Date(customStart) > new Date(customEnd)) {
      setError("Start date cannot be later than end date.");
      return;
    }
    setError(null);
    fetchAnalytics();
  };

  const { summary, timeseries, topCampaigns, recentActivity, failures } = data;

  // Format short date for chart axes
  const formatAxisDate = (dateStr) => {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length >= 3) {
      return `${parts[1]}/${parts[2]}`;
    }
    return dateStr;
  };

  // Engagement Funnel Data for bar chart
  const funnelData = [
    { name: "Targeted", count: summary.targetedRecipients || 0, fill: "#7657d6" },
    { name: "Submitted", count: summary.submitted || 0, fill: "#4f9be8" },
    { name: "Delivered", count: summary.delivered || 0, fill: "#2caa76" },
    { name: "Opened", count: summary.opened || 0, fill: "#f59e0b" },
    { name: "Clicked", count: summary.clicked || 0, fill: "#ec4899" }
  ];

  // Sorted top campaigns
  const sortedCampaigns = [...(topCampaigns || [])].sort((a, b) => {
    if (topSortBy === "openRate") return b.openRate - a.openRate;
    if (topSortBy === "clickRate") return b.clickRate - a.clickRate;
    if (topSortBy === "delivered") return b.delivered - a.delivered;
    if (topSortBy === "submitted") return b.submitted - a.submitted;
    return 0;
  });

  return (
    <div className="page-stack analytics-dashboard">
      {/* 1. Header & Controls */}
      <div className="page-title-row">
        <div>
          <span className="eyebrow">PERFORMANCE INTELLIGENCE</span>
          <h1>Campaign Analytics & Reports</h1>
          <p className="muted">
            Track real-time delivery confirmations, engagement rates, and deliverability trends across your campaigns.
          </p>
        </div>

        <div className="analytics-header-actions">
          {/* Date range chips */}
          <div className="action-chips">
            <button
              className={`chip ${range === "7d" ? "chip-active" : ""}`}
              onClick={() => handleRangeChange("7d")}
            >
              Last 7 days
            </button>
            <button
              className={`chip ${range === "30d" ? "chip-active" : ""}`}
              onClick={() => handleRangeChange("30d")}
            >
              Last 30 days
            </button>
            <button
              className={`chip ${range === "90d" ? "chip-active" : ""}`}
              onClick={() => handleRangeChange("90d")}
            >
              Last 90 days
            </button>
            <button
              className={`chip ${range === "custom" ? "chip-active" : ""}`}
              onClick={() => handleRangeChange("custom")}
            >
              <Calendar size={13} style={{ marginRight: 4 }} />
              Custom
            </button>
          </div>

          <button
            className="soft-button"
            onClick={fetchAnalytics}
            title="Refresh analytics data"
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Custom Date Range Picker */}
      {showCustomPicker && (
        <form className="panel custom-date-bar" onSubmit={handleApplyCustomRange}>
          <div className="custom-date-inputs">
            <label>
              <span>From:</span>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                required
              />
            </label>
            <label>
              <span>To:</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="primary-button" disabled={loading}>
              Apply Range
            </button>
          </div>
        </form>
      )}

      {/* Error Banner */}
      {error && (
        <div className="error-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button className="soft-button" onClick={fetchAnalytics} style={{ padding: "4px 8px", fontSize: 11 }}>
            Retry
          </button>
        </div>
      )}

      {/* Tracking Limitations / Privacy Compliance Note */}
      <div className="notice tracking-notice">
        <Info size={16} style={{ flexShrink: 0 }} />
        <div>
          <b>Delivery & Tracking Transparency:</b> Opens and clicks depend on Brevo webhook callbacks. Opens are recorded via an invisible 1x1 tracking pixel; privacy protection tools (e.g. Apple Mail Privacy Protection) or image blocking may prevent open tracking from recording.
        </div>
      </div>

      {/* 2. Key Metrics Summary Grid */}
      <div className="stats-grid">
        <StatCard
          label="Emails Submitted"
          value={summary.submitted?.toLocaleString() || "0"}
          change="Accepted by Brevo SMTP API"
          icon={Send}
          tone="blue"
        />
        <StatCard
          label="Delivered Emails"
          value={summary.delivered?.toLocaleString() || "0"}
          change={`${summary.deliveryRate || 0}% delivery rate`}
          icon={CheckCircle2}
          tone="green"
        />
        <StatCard
          label="Open Rate"
          value={`${summary.openRate || 0}%`}
          change={`${summary.opened?.toLocaleString() || 0} unique recipients opened`}
          icon={Eye}
          tone="purple"
        />
        <StatCard
          label="Click Rate"
          value={`${summary.clickRate || 0}%`}
          change={`${summary.clicked?.toLocaleString() || 0} unique link clicks`}
          icon={MousePointerClick}
          tone="orange"
        />
      </div>

      {/* Secondary Metrics Bar */}
      <div className="secondary-metrics-row">
        <div className="metric-pill">
          <Users size={15} />
          <span>Total Targeted: <b>{summary.targetedRecipients?.toLocaleString() || 0}</b></span>
        </div>
        <div className="metric-pill">
          <AlertTriangle size={15} color="#db9545" />
          <span>Bounce Rate: <b>{summary.bounceRate || 0}%</b> ({summary.bounced || 0} bounced)</span>
        </div>
        <div className="metric-pill">
          <XCircle size={15} color="#c34a4a" />
          <span>Delivery Failures: <b>{summary.failed || 0}</b></span>
        </div>
        <div className="metric-pill">
          <ShieldAlert size={15} color="#7657d6" />
          <span>Complaints: <b>{summary.complained || 0}</b></span>
        </div>
        <div className="metric-pill">
          <Mail size={15} />
          <span>Total Campaigns: <b>{summary.totalCampaigns || 0}</b></span>
        </div>
      </div>

      {/* 3. Charts Section */}
      <div className="dashboard-grid">
        {/* Main Performance Over Time Chart */}
        <div className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h3><TrendingUp size={16} /> Performance Over Time</h3>
              <p>Daily volume of submitted, delivered, opened, and clicked emails</p>
            </div>
            <span className="ai-label">{range.toUpperCase()} WINDOW</span>
          </div>

          <div className="chart-legend">
            <span><i className="dot" style={{ background: "#4f9be8" }} /> Submitted</span>
            <span><i className="dot" style={{ background: "#2caa76" }} /> Delivered</span>
            <span><i className="dot" style={{ background: "#f59e0b" }} /> Opened</span>
            <span><i className="dot" style={{ background: "#ec4899" }} /> Clicked</span>
          </div>

          <div className="chart-wrap" style={{ height: 270 }}>
            {timeseries && timeseries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeseries}>
                  <defs>
                    <linearGradient id="submittedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f9be8" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#4f9be8" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="deliveredFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2caa76" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#2caa76" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0f6" />
                  <XAxis dataKey="date" tickFormatter={formatAxisDate} axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #eceef4", fontSize: 12 }}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Area type="monotone" dataKey="submitted" stroke="#4f9be8" fill="url(#submittedFill)" strokeWidth={2} name="Submitted" />
                  <Area type="monotone" dataKey="delivered" stroke="#2caa76" fill="url(#deliveredFill)" strokeWidth={2} name="Delivered" />
                  <Area type="monotone" dataKey="opened" stroke="#f59e0b" fill="none" strokeWidth={2} name="Opened" />
                  <Area type="monotone" dataKey="clicked" stroke="#ec4899" fill="none" strokeWidth={2} name="Clicked" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-chart-state">
                <BarChart3 size={32} color="#a0a5b2" />
                <p>No activity recorded in this time range.</p>
              </div>
            )}
          </div>
        </div>

        {/* Funnel & Breakdown Chart */}
        <div className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h3><BarChart3 size={16} /> Delivery & Funnel Breakdown</h3>
              <p>Progression from targeted audience to link clicks</p>
            </div>
          </div>

          <div className="chart-wrap" style={{ height: 285 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ top: 10, right: 30, left: 15, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#edf0f6" />
                <XAxis type="number" axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={75} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #eceef4", fontSize: 12 }}
                  formatter={(val) => [val.toLocaleString(), "Recipients"]}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 4. Top Performing Campaigns Table */}
      <div className="panel table-panel">
        <div className="panel-heading" style={{ padding: "0 20px 18px", borderBottom: "1px solid #f0f1f5" }}>
          <div>
            <h3>Top Performing Campaigns</h3>
            <p>Compare delivery, open, and click conversion rates across sent campaigns</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "#8b91a3" }}>Sort by:</span>
            <select
              value={topSortBy}
              onChange={(e) => setTopSortBy(e.target.value)}
              className="analytics-sort-select"
            >
              <option value="openRate">Open Rate</option>
              <option value="clickRate">Click Rate</option>
              <option value="delivered">Delivered Count</option>
              <option value="submitted">Submitted Count</option>
            </select>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Date</th>
                <th>Targeted</th>
                <th>Delivered</th>
                <th>Open Rate</th>
                <th>Click Rate</th>
                <th>Bounce Rate</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedCampaigns && sortedCampaigns.length > 0 ? (
                sortedCampaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 700, color: "#20243a" }}>{c.name}</div>
                      <div style={{ fontSize: 10, color: "#8b91a3" }}>{c.subject || "No subject"}</div>
                    </td>
                    <td>
                      <span className={`status ${c.status === "SENT" ? "good" : c.status === "SENDING" ? "draft" : "muted-status"}`}>
                        {c.status}
                      </span>
                    </td>
                    <td>
                      {c.sentAt ? new Date(c.sentAt).toLocaleDateString() : c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                    </td>
                    <td>{c.sendTotal?.toLocaleString() || 0}</td>
                    <td>
                      <span style={{ color: "#269769", fontWeight: 600 }}>
                        {c.delivered?.toLocaleString() || 0}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div className="mini-progress-bar">
                          <div className="mini-progress-fill" style={{ width: `${Math.min(c.openRate, 100)}%` }} />
                        </div>
                        <span style={{ fontWeight: 700, minWidth: 42 }}>{c.openRate}%</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, color: c.clickRate > 0 ? "#7657d6" : "#8b91a3" }}>
                        {c.clickRate}%
                      </span>
                    </td>
                    <td>
                      <span style={{ color: c.bounceRate > 5 ? "#c34a4a" : "#8b91a3" }}>
                        {c.bounceRate}%
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="soft-button"
                        onClick={() => setSelectedCampaign(c)}
                        title="AI Campaign Performance Optimizer"
                        style={{ padding: "4px 8px", fontSize: 10, color: "#6545bc", fontWeight: 700 }}
                      >
                        <Sparkles size={11} /> Optimize
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "36px 20px", color: "#8b91a3" }}>
                    No campaigns dispatched in this time window.{" "}
                    <Link to="/app/campaigns" style={{ color: "#6545bc", fontWeight: 700 }}>
                      Create a campaign →
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Bottom Section: Recent Activity & Failures Summary */}
      <div className="dashboard-grid">
        {/* Recent Campaign Activity */}
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h3>Recent Campaign Activity</h3>
              <p>Latest campaigns updated or dispatched in your workspace</p>
            </div>
            <Link to="/app/campaigns" className="soft-button">
              View All <ArrowUpRight size={13} />
            </Link>
          </div>

          <div className="activity-list">
            {recentActivity && recentActivity.length > 0 ? (
              recentActivity.map((a) => (
                <div key={a.id} className="activity-item">
                  <div className="activity-icon-wrap">
                    <Send size={15} color="#7657d6" />
                  </div>
                  <div className="activity-content">
                    <div className="activity-title-row">
                      <span className="activity-title">{a.name}</span>
                      <span className={`status ${a.status === "SENT" ? "good" : a.status === "SENDING" ? "draft" : "muted-status"}`}>
                        {a.status}
                      </span>
                    </div>
                    <div className="activity-details">
                      <span>{a.sendTotal || 0} targeted</span>
                      <span>·</span>
                      <span>{a.deliveredCount || 0} delivered</span>
                      <span>·</span>
                      <span>{a.openRate || 0}% opened</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => setSelectedCampaign(a)}
                    title="AI Campaign Performance Optimizer"
                    style={{ padding: "4px 8px", fontSize: 10, color: "#6545bc", fontWeight: 700, marginLeft: "auto" }}
                  >
                    <Sparkles size={11} /> Optimize
                  </button>
                </div>
              ))
            ) : (
              <div style={{ textAlign: "center", padding: "24px", color: "#8b91a3" }}>
                No recent campaign activity.
              </div>
            )}
          </div>
        </div>

        {/* Failed & Bounced Issues Panel */}
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h3><AlertTriangle size={16} color="#db9545" /> Delivery Issues & Failures</h3>
              <p>Breakdown of bounces and dispatch errors requiring attention</p>
            </div>
          </div>

          <div className="failure-summary-cards">
            <div className="failure-card">
              <span className="failure-number">{failures?.breakdown?.bounced || 0}</span>
              <span className="failure-label">Bounced</span>
            </div>
            <div className="failure-card">
              <span className="failure-number">{failures?.breakdown?.failed || 0}</span>
              <span className="failure-label">Provider Failed</span>
            </div>
            <div className="failure-card">
              <span className="failure-number">{failures?.breakdown?.complained || 0}</span>
              <span className="failure-label">Spam Complaints</span>
            </div>
          </div>

          <div className="recent-failures-list">
            <div className="eyebrow" style={{ margin: "14px 0 8px" }}>RECENT FAILED RECIPIENTS</div>
            {failures?.recentFailures && failures.recentFailures.length > 0 ? (
              failures.recentFailures.slice(0, 4).map((f) => (
                <div key={f.id} className="failure-item">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 11 }}>{f.email}</div>
                    <div style={{ fontSize: 10, color: "#c34a4a" }}>{f.error}</div>
                  </div>
                  <span className="status muted-status" style={{ fontSize: 9 }}>
                    {f.status}
                  </span>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 11, color: "#269769", padding: "12px 0" }}>
                ✓ No delivery failures or bounces recorded in this period.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI CAMPAIGN PERFORMANCE OPTIMIZER MODAL */}
      {selectedCampaign && (
        <CampaignOptimizerModal
          campaignId={selectedCampaign.id}
          initialCampaign={selectedCampaign}
          onClose={() => setSelectedCampaign(null)}
          onCampaignUpdated={() => {
            fetchAnalytics();
          }}
          writable={writable}
        />
      )}
    </div>
  );
}
